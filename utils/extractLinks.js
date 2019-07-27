import parse5 from 'parse5';
import axios from 'axios';
import { URL } from 'url';

import queryStringFilters from './queryStringFilters';
import blackList from './blackList';
import getFullAcct from './getFullAcct';

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

function isResourceLink(status, href) {
    const domain = status.account.acct.split('@')[1] || null;
    const isExternalTag =
        domain != null &&
        href.indexOf(domain) >= 0 &&
        (href.match(/\/tags?\//) || href.match(/\?tags?\=/));
    if (isExternalTag) {
        return true;
    }
    const isTag = status.tags.find(tag => tag.url === href);
    if (isTag) {
        return true;
    }
    const isMention = status.mentions.find(mention => mention.url === href);
    if (isMention) {
        return true;
    }
    const isMedia = status.media_attachments.find(
        media =>
            href.includes(media.url) ||
            href.includes(media.preview_url) ||
            href.includes(media.remote_url) ||
            href.includes(media.text_url)
    );
    if (isMedia) {
        return true;
    }
    return false;
}

function filterLinks(status, links) {
    return links.filter(link => !isResourceLink(status, link.href));
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

async function resolveRedirects (links) {
    const resolvedLinks = [];
    const pushLink = link => resolvedLinks.push(cleanLink(link));
    await Promise.all(links.map(async (link) => {
        const response = await axios.head(link.href).catch(err => err);
        if (!response || response instanceof Error) {
            pushLink({ ...link, status: 0, hrefCanonical: link.href });
            return;
        }
        const { status, request } = response;
        if (request.res && request.res.responseUrl) {
            const { responseUrl: hrefCanonical } = request.res;
            if (hrefCanonical !== link.href) {
                pushLink({ ...link, status, hrefCanonical });
            }
        }
    }));
    return resolvedLinks;
}


export function extractLinks(status, instance) {
    if (blackList.accounts.includes(getFullAcct(status.account, instance))) {
        return [];
    }
    const content = parse5.parseFragment(status.content);
    const rawLinks = getLinks(content);
    const filteredLinks = filterLinks(status, rawLinks);
    return resolveRedirects(filteredLinks).then(resolvedLinks =>
        resolvedLinks.filter(
            link => !isResourceLink(status, link.hrefCanonical)
        )
    );
}
