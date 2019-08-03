import EventSource from 'eventsource';
import { w3cwebsocket as WebSocketClient } from 'websocket';
import { extractLinks } from './utils/extractLinks';

const feedStore = {};
const statusStore = {};

function monitorFeed(instance, ws = true) {
    const base = `//${instance}/api/v1/streaming`;
    if (ws) {
        const websocket = new WebSocketClient(`wss:${base}?stream=public`);
        websocket.addEventListener('open', handleOpen);
        websocket.addEventListener('error', handleError);
        websocket.addEventListener('close', handleClose);
        websocket.addEventListener('message', handleUpdateWS);
        feedStore[instance] = websocket;
    } else {
        const eventSource = new EventSource(`https:${base}/public`);
        eventSource.addEventListener('open', handleOpen);
        eventSource.addEventListener('error', handleError);
        eventSource.addEventListener('delete', handleDeleteES);
        eventSource.addEventListener('update', handleUpdateES);
        feedStore[instance] = eventSource;
    }

    function handleOpen(event) {
        console.log(`\x1B[41m OPEN: [${instance}] \x1B[49m`);
    }

    function handleError(event) {
        const meta = ws ? {} : event;
        console.log(`\x1B[41m ERROR: [${instance}] \x1B[49m`, meta);
    }

    function handleClose(event) {
        const meta = ws ? { code: event.code, reason: event.reason } : event;
        console.log(`\x1B[41m CLOSE: [${instance}] \x1B[49m`, meta);
    }

    function handleDeleteES(event) {
        const id = JSON.parse(event.data);
        handleDelete(id);
    }

    function handleUpdateES(event) {
        const status = JSON.parse(event.data);
        handleUpdate(status);
    }

    function handleUpdateWS(event) {
        const json = JSON.parse(event.data);
        switch (json.event) {
            case 'update':
                handleUpdate(JSON.parse(json.payload));
                break;
            case 'delete':
                handleDelete(json.payload);
                break;
            default:
                console.log(`#### UNKNOWN TYPE ${json.event} ####`);
                console.log(json.payload);
                break;
        }
    }

    function handleDelete(id) {
        // console.log(`######### DELETE ${id}`);
    }

    async function handleUpdate(status) {
        if (typeof statusStore[status.uri] === 'undefined') {
            statusStore[status.uri] = status;
            const links = await extractLinks(status, instance);
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
                const langCode = status.language || '??';
                const lang = `\x1B[97m${langCode}\x1B[39m`;
                const acct = `\x1B[97m${status.account.acct}\x1B[39m`;
                const log = `[${lang}] [${acct}] [${instance}]`;
                const emptyWidth =
                    72 -
                    status.account.acct.length -
                    langCode.length -
                    instance.length;
                const empty = Array.from({ length: emptyWidth }).join(' ');
                console.log(`\x1B[48;5;235m${log}${empty}\x1B[49m`);
                console.log(urls.join('\n'));
            }
        }
    }
}

monitorFeed('mastodon.social');
monitorFeed('mastodon.cloud');
monitorFeed('pawoo.net');
// monitorFeed('gab.com');
