var EosApi = require('eosjs-api');
var fs = require('fs');
var config = require('../config.js');

var CHECK_POINT_FILE = config.database.stake_check_point_file;
eos = EosApi({
    httpEndpoint: config.httpEndPoint,
   logger: {
	error: null,
	log: null
   }
})

var current = parseInt(fs.readFileSync(CHECK_POINT_FILE, "utf-8"));
console.log("start fetch block from", current);

function fetchBlock(){
    eos.getBlock(current, (error, result) => {
        if(!error){
            current++;
            try{
                parseBlock(result, true);
                fs.writeFileSync(CHECK_POINT_FILE, current);
            }catch(e){
                console.log(e, JSON.stringify(result));
                throw e;
            }

        }else{
            //console.log(error)
        }
        fetchBlock();
    })
}

function listenBlock(){
    fetchBlock();
}


function parseBlock(line, json){
    if(!json){
        try{
            line = JSON.parse(line);
        }catch(e){

        }
    }else{ }
    line.transactions.forEach(function(transaction){
        if(transaction.status != "hard_fail" && typeof transaction.trx != "string"){
            transaction.trx.transaction.actions.forEach(function(action){
                handleAction(action, line);
            })
        }
    })
}


function handleAction(action, block){
    var actionName = action.name;
    try{
        actionHanddler[actionName]  && actionHanddler[actionName](action['data'], block);
    }catch(e){
        console.error("parseActionError", e);
    }
}


function getAccountData(account){
    return new Promise(function(resolve, reject){
        Promise.all([
            eos.getAccount({
                account_name: account
            }),
            eos.getCurrencyBalance({
                code: "eosio.token",
                account: account
            })
        ]).then(function(res){
            res[0].blance = res[1];
            resolve(res[0])
        }, function(err){
            reject(error);
            console.log("error", err);
        }).catch(function(err){
            reject(error);
            console.log("error", err);
        })
    })
}


var actionHanddler = {};

actionHanddler['delegatebw'] = function(data, block){
    data.block_num = block.block_num;
    data.timestamp = block.timestamp;
    fs.appendFileSync(config.database.all_delegatebw, JSON.stringify(data)+"\n");
}


actionHanddler['undelegatebw'] = function(data, block){
    data.block_num = block.block_num;
    data.timestamp = block.timestamp;
    fs.appendFileSync(config.database.all_delegatebw, JSON.stringify(data)+"\n");
}


listenBlock();
