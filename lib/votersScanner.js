
const config = require('../config');
var EosApi = require('eosjs-api');
const EosJs = require("eosjs");
var fs = require('fs');
var moment = require('moment');

var eosClient = EosApi({
    httpEndpoint: config.httpEndPoint,
    logger: {
        error: null,
        log: null
    }
})

var _cacheState = {};

if(fs.existsSync(config.database.table_voters)){
    try{
        _cacheState = JSON.parse(fs.readFileSync(config.database.table_voters));
    }catch(e){}
}


function voterScanner(allVoters){
    var interval = 86400 * 1000;
    async function fetchVoterState(voter){
        console.log('voterScanner fetchVoterState', voter)
        var accountKey = EosJs.modules.format.encodeName(voter, false);
        var voterStakeData = await eosClient.getTableRows({
            json: true, 
            code: "eosio", 
            scope: "eosio",
            table: "voters", 
            table_key: "", 
            lower_bound: accountKey,
            upper_bound: -1,
            limit: 1
        });

        if(voterStakeData.rows.length){
            var voterMeta = voterStakeData.rows[0];
            _cacheState[voter] = voterMeta;
        }
    }

    async function refresh(){
        var voters = Object.keys(allVoters);
        for (let index = 0; index < voters.length; index++) {
            const voter = voters[index];
            try{
                await fetchVoterState(voter);
            }catch(e){
                console.log('fetchVoterState error', e);
            }
        }
        setTimeout(() => {
            (async () => {
                await refresh();
            })();
        }, 10 * 1000);
    }
    
    (async () => {
        await refresh();
    })();


    setInterval(() => {
        fs.writeFileSync(config.database.table_voters, JSON.stringify(_cacheState));
    },  60 * 1000);

    return {
        getVoterState:  function(voter){
            return _cacheState[voter];
        }
    }
}


module.exports = voterScanner;
