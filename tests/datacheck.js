

var EosApi = require('eosjs-api');
var request = require('request-promise');

eos = EosApi({
  httpEndpoint: 'https://mainnet.meet.one',
  logger: {
  }
});



(async () => {

    var proxy = 'cannonproxy1';
    var proxyData = await request.get('https://api.tallymeter.io/getVoter/'+proxy);

    proxyData = JSON.parse(proxyData);

    console.log(proxyData)
    
    for (let index = 0; index < proxyData.proxy_voters.length; index++) {
        const voter = proxyData.proxy_voters[index];
        var account = await eos.getAccount({
            account_name: voter
        });

        if(proxy == account.voter_info.proxy){
            console.log(voter, 'checkpassed');

        }else{
            console.log(voter, account.voter_info);
        }
    }
})();

