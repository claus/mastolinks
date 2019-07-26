const parse5 = require('parse5');
const axios = require('axios');
const URL = require('url').URL;

const queryStringFilters = require('./queryStringFilters');
const blackList = require('./blackList');
const getFullAcct = require('./getFullAcct');

function getTextContent(el) {
    let text = '';
    if (el) {
        if (el.nodeName === '#text' && el.value && el.value.length) {
            text = el.value;
        }
        if (el.childNodes) {
            el.childNodes.forEach(child => {
                text += getTextContent(child, text);
            });
        }
    }
    return text;
}

function getLinks(el, links = []) {
    if (el) {
        if (el.nodeName === 'a') {
            const hrefAttr = el.attrs.find(attr => attr.name === 'href');
            if (hrefAttr && hrefAttr.value) {
                links.push({
                    href: hrefAttr.value,
                    text: getTextContent(el),
                });
            }
        }
        if (el.childNodes) {
            el.childNodes.forEach(node => {
                getLinks(node, links);
            });
        }
    }
    return links;
}

function filterLink(status, href) {
    const domain = status.account.acct.split('@')[1] || null;
    const isExternalTag =
        domain != null &&
        href.indexOf(domain) >= 0 &&
        (href.match(/\/tags?\//) || href.match(/\?tags?\=/));
    if (isExternalTag) {
        return false;
    }
    const isTag = status.tags.find(tag => tag.url === href);
    if (isTag) {
        return false;
    }
    const isMention = status.mentions.find(mention => mention.url === href);
    if (isMention) {
        return false;
    }
    const isMedia = status.media_attachments.find(
        media =>
            media.url === href ||
            media.preview_url === href ||
            media.remote_url === href ||
            media.text_url === href
    );
    if (isMedia) {
        return false;
    }
    return true;
}

function filterLinks(status, links) {
    return links.filter(link => filterLink(status, link.href));
}

function cleanLink(link) {
    const url = new URL(link.hrefCanonical);
    const hostnameParts = url.hostname.split('.');
    const searchParams = url.searchParams;
    const filterSearchParams = (params, filters = []) => {
        const deleteCandidates = [];
        params.forEach((value, name) => {
            if (filters.includes(name.toLowerCase())) {
                deleteCandidates.push(name);
            }
        });
        deleteCandidates.forEach(filter => params.delete(filter));
    };
    for (let i = hostnameParts.length - 2; i >= 0; i--) {
        const hostnameTest = hostnameParts.slice(i).join('.');
        const filters = queryStringFilters.domains[hostnameTest];
        filterSearchParams(searchParams, filters);
    }
    filterSearchParams(searchParams, queryStringFilters.default);
    return {
        ...link,
        hrefClean: url.href,
    };
}

function resolveRedirects(links) {
    return Promise.all(
        links.map(link => {
            return new Promise((resolve, reject) => {
                axios
                    .head(link.href)
                    .then(response => {
                        if (
                            response &&
                            response.request &&
                            response.request.res &&
                            response.request.res.responseUrl
                        ) {
                            const { responseUrl } = response.request.res;
                            if (responseUrl !== link.href) {
                                resolve({
                                    ...link,
                                    status: response.status,
                                    hrefCanonical: responseUrl,
                                });
                                return;
                            }
                        }
                        resolve({
                            ...link,
                            status: response ? response.status : 0,
                            hrefCanonical: link.href,
                        });
                    })
                    .catch(err => {
                        resolve({
                            ...link,
                            status: err.response ? err.response.status : 0,
                            hrefCanonical: link.href,
                        });
                    });
            }).then(cleanLink);
        })
    );
}

function extractLinks(status, instance) {
    if (blackList.accounts.includes(getFullAcct(status.account, instance))) {
        return [];
    }
    const content = parse5.parseFragment(status.content);
    const rawLinks = getLinks(content);
    const filteredLinks = filterLinks(status, rawLinks);
    return resolveRedirects(filteredLinks);
}

module.exports.extractLinks = extractLinks;
module.exports.filterLink = filterLink;
