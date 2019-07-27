'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

const EventSource = _interopDefault(require('eventsource'));
const parse5 = _interopDefault(require('parse5'));
const axios = _interopDefault(require('axios'));
const url = require('url');
const os = _interopDefault(require('os'));

const pool = new Array(os.cpus().length).fill(null);

class PromisePool {
  constructor (jobs, handler) {
    this.handler = handler;
    this.jobs = jobs;
  }

  async done () {
    await Promise.all(pool.map(() => {
      // eslint-disable-next-line no-async-promise-executor
      return new Promise(async (resolve) => {
        while (this.jobs.length) {
          let job;
          try {
            job = this.jobs.pop();
            await this.handler(job);
          } catch (err) {
            console.log('Failed: ', job, err);
          }
        }
        resolve();
      });
    }));
  }
}

const queryStringFilters = {
  domains: {
    'nytimes.com': ['smid', 'smtyp'],
    'youtube.com': ['app', 'feature'],
    'thehill.com': ['userid'],
    'twitter.com': ['s'],
    'reuters.com': ['feedtype', 'feedname'],
    'zeit.de': ['wt_zmc'],
    'washingtonpost.com': ['noredirect']
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
    'newsletterad'
  ]
};

const blackList = {
  accounts: [
    'monitoring@fediverse.network'
  ]
};

function getFullAcct (account, defaultInstance) {
  const { acct } = account;
  return acct.indexOf('@') >= 0 ? acct : `${acct}@${defaultInstance}`;
}

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

async function resolveRedirects (links) {
  const resolvedLinks = [];
  const pushLink = link => resolvedLinks.push(cleanLink(link));
  const pool = new PromisePool(links, async (link) => {
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
  });
  await pool.done();
  return resolvedLinks;
}


function extractLinks(status, instance) {
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

const instance = 'mastodon.social';
const es = new EventSource(`https://${instance}/api/v1/streaming/public`);

es.onopen = event => console.info('### OPEN', event);
es.onerror = event => console.error('### ERROR', event);

async function handleUpdate(event) {
  const data = JSON.parse(event.data);
  const links = await extractLinks(data, instance);
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
      const emptyWidth = 76 - data.account.acct.length - langCode.length;
      const lang = `\x1B[97m${langCode}\x1B[39m`;
      const acct = `\x1B[97m${data.account.acct}\x1B[39m`;
      const empty = Array.from({ length: emptyWidth }).join(' ');
      console.log(`\x1B[48;5;235m[${lang}] [${acct}]${empty}\x1B[49m`);
      console.log(urls.join('\n'));
  }
}

function handleDelete(event) {
  const id = JSON.parse(event.data);
  // console.log('### DELETE', id);
}

es.addEventListener('update', handleUpdate);
es.addEventListener('delete', handleDelete);
