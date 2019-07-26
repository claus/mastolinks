module.exports = function getFullAcct(account, defaultInstance) {
    const { acct } = account;
    return acct.indexOf('@') >= 0 ? acct : `${acct}@${defaultInstance}`;
}
