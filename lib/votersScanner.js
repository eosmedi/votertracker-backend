
const config = require('../config');
var EosApi = require('eosjs-api');
const EosJs = require("eosjs");
var fs = require('fs');
var moment = require('moment');
var bigInt = require('big-integer');

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

    async function dumpTable(){
        var stop = true;
        var nextKey = 0;
        while(stop){
            var data = await eosClient.getTableRows({
                json: true,
                code: "eosio",
                scope: "eosio",
                table: "voters",
                table_key: "",
                limit: 300,
                lower_bound: nextKey,
                upper_bound: -1
            });
            var lastName = '';
            data.rows.forEach((d) => {
                lastName = d.owner;
                _cacheState[d.owner] = d;
            })
            console.log('count', Object.keys(_cacheState).length, nextKey+'');
            if(data.more){
                var nameIndex = EosJs.modules.format.encodeName(lastName, false);
                nextKey = bigInt(nameIndex).add(1);
            }else{
                stop = false;
                break;
            }
        }

        fs.writeFileSync(config.database.table_voters, JSON.stringify(_cacheState));
    }


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
    
    // (async () => {
    //     await refresh();
    // })();


    async function loop(){
        await dumpTable();
        await loop();
    }

    (async () => {
        await loop();
    })();


    // setInterval(() => {
    //     fs.writeFileSync(config.database.table_voters, JSON.stringify(_cacheState));
    // },  60 * 1000);

    return {

        getVoterState:  function(voter){
            return _cacheState[voter];
        }

    }
}


var scanner = new voterScanner();



module.exports = voterScanner;
