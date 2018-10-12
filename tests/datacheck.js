

var EosApi = require('eosjs-api');

eos = EosApi({
  httpEndpoint: 'https://mainnet.meet.one',
  logger: {
  }
})



var proxy = 'eostitanvote';
var voters = ["heztaojqg4ge", "titanexplore", "eosmechanics", "systemzaxeos", "eostitansign", "heztknygenes", "heytanigenes", "geytmmjwgige", "ge4dgobtgyge", "geytkmbvgene", "haztgnztgene", "gy2dcoigenes", "eostitanramm", "eostitandapp", "eostitanprod", "ge3tkmrzgyge", "haydqmjyhage", "gi4tsobrgene", "itokenpocket", "g44tanbtgqge", "g44domzsgqge", "rockandblues", "ge3denjygqge", "gyzdkmryguge", "gy2dcmbuhege", "prajrrv32kxw", "hhilyquerida"];

(async () => {
    for (let index = 0; index < voters.length; index++) {
        const voter = voters[index];
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

