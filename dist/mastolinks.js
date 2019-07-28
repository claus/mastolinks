'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

const EventSource = _interopDefault(require('eventsource'));
const parse5 = _interopDefault(require('parse5'));
const axios = _interopDefault(require('axios'));
const url = require('url');

const queryStringFilters = {
    domains: {
        'nytimes.com': ['smid', 'smtyp'],
        'youtube.com': ['app', 'feature'],
        'thehill.com': ['userid'],
        'twitter.com': ['s'],
        'reuters.com': ['feedtype', 'feedname'],
        'zeit.de': ['wt_zmc'],
        'washingtonpost.com': ['noredirect'],
        'dw.com': ['maca'],
    },
    default: [
        'utm_source',
        'utm_medium',
        'utm_term',
        'utm_campaign',
        'utm_content',
        'utm_name',
        'utm_cid',
        'utm_reader',
        'utm_viz_id',
        'utm_pubreferrer',
        'utm_swu',
        'utm_sq',
        'utm_int',
        'igshid',
        'fbclid',
        'gclid',
        'ocid',
        'ncid',
        'bcid',
        'bhid',
        'recid',
        'icid',
        'ito',
        'wkey',
        'wemail',
        'wtmc',
        'wt_mc',
        'nr_email_referer',
        'ref',
        'spm',
        'ftag',
        'recip',
        'ktm_source',
        'mkt_toc',
        'mkt_tok',
        'mc_cid',
        'mc_eid',
        'ns_source',
        'ns_mchannel',
        'ns_campaign',
        'ns_linkname',
        'ns_fee',
        'sr_share',
        'vero_conv',
        'vero_id',
        '_hsenc',
        '_hsmi',
        'hsctatracking',
        '__twitter_impression',
        'newsletterad',
        'sessid',
    ],
};

function getTextContent(el) {
    let text = '';
    if (el) {
        if (el.nodeName === '#text' && el.value && el.value.length) {
            text = el.value;
        }
        if (el.childNodes) {
            el.childNodes.forEach(child => {
                text += getTextContent(child);
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
    const url$1 = new url.URL(link.hrefCanonical);
    const hostnameParts = url$1.hostname.split('.');
    const searchParams = url$1.searchParams;
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
        hrefClean: url$1.href,
    };
}

function resolveRedirects(links) {
    return Promise.all(
        links.map(link => {
            return new Promise(async resolve => {
                const response = await axios.head(link.href).catch(err => err);
                if (!response || response instanceof Error) {
                    resolve({ ...link, status: 0, hrefCanonical: link.href });
                    return;
                }
                const { status, request } = response;
                if (request.res && request.res.responseUrl) {
                    const { responseUrl: hrefCanonical } = request.res;
                    if (hrefCanonical !== link.href) {
                        resolve({ ...link, status, hrefCanonical });
                        return;
                    }
                }
                resolve({ ...link, status: 0, hrefCanonical: link.href });
            }).then(cleanLink);
        })
    );
}

function extractLinks(status, instance) {
    const content = parse5.parseFragment(status.content);
    const rawLinks = getLinks(content);
    const filteredLinks = filterLinks(status, rawLinks);
    return resolveRedirects(filteredLinks).then(resolvedLinks =>
        resolvedLinks.filter(
            link => !isResourceLink(status, link.hrefCanonical)
        )
    );
}

function monitorFeed(instance) {
    const es = new EventSource(`https://${instance}/api/v1/streaming/public`);

    es.addEventListener('open', handleOpen);
    es.addEventListener('error', handleError);
    es.addEventListener('update', handleUpdate);
    es.addEventListener('delete', handleDelete);

    function handleOpen(event) {
        console.log(`\x1B[41m OPEN: [${instance}] \x1B[49m`, event);
    }

    function handleError(event) {
        console.log(`\x1B[41m ERROR: [${instance}] \x1B[49m`, event);
    }

    async function handleUpdate(event) {
        const data = JSON.parse(event.data);
        const links = await extractLinks(data);
        if (links.length) {
            const urls = links.map(link => {
                let str = `- \x1B[33m${link.hrefClean}\x1B[39m`;
                if (link.status >= 400) {
                    str += ` \x1B[41m[${link.status}]\x1B[49m`;
                }
                if (link.hrefCanonical !== link.hrefClean) {
                    str += `\n  \x1B[90m${link.hrefCanonical}\x1B[39m`;
                }
                if (link.href !== link.hrefCanonical) {
                    str += `\n  \x1B[90m${link.href}\x1B[39m`;
                }
                return str;
            });
            const langCode = data.language || '??';
            const lang = `\x1B[97m${langCode}\x1B[39m`;
            const acct = `\x1B[97m${data.account.acct}\x1B[39m`;
            const log = `[${lang}] [${acct}] [${instance}]`;
            const emptyWidth =
                72 -
                data.account.acct.length -
                langCode.length -
                instance.length;
            const empty = Array.from({ length: emptyWidth }).join(' ');
            console.log(`\x1B[48;5;235m${log}${empty}\x1B[49m`);
            console.log(urls.join('\n'));
        }
    }

    function handleDelete(event) {
        const id = JSON.parse(event.data);
        // console.log(`\x1B[41m DELETE: [${instance}] \x1B[49m`, id);
    }
}

monitorFeed('mastodon.social');
monitorFeed('mastodon.cloud');
monitorFeed('pawoo.net');
