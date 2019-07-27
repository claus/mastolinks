import EventSource from 'eventsource';
import { extractLinks } from './utils/extractLinks';

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
