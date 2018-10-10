var EosApi = require('eosjs-api');
var fs = require('fs');
var config = require('../config.js');
const elasticWriteStream = require('../lib/elasticWriteStream');

eos = EosApi({
    httpEndpoint: config.httpEndPoint,
    logger: {
	    error: null,
	    log: null
    }
})

var CHECK_POINT_FILE = config.database.vote_check_point_file;

if(!fs.existsSync(CHECK_POINT_FILE)){
    fs.writeFileSync(CHECK_POINT_FILE, '1');
}

var current = parseInt(fs.readFileSync(CHECK_POINT_FILE, "utf-8"));


console.log("start fetch block from", current);

function fetchBlock(){
    // console.log('fetchBlock', current)
    eos.getBlock(current, (error, result) => {
        if(!error){
            current++;
            try{
                parseBlock(result, true);
                fs.writeFileSync(CHECK_POINT_FILE, current);
            }catch(e){
                console.log(e, JSON.stringify(result));
                setTimeout(() => {
                    fetchBlock();
                }, 10 * 1000);
                return;
            }
        }else{
            setTimeout(() => {
                fetchBlock();
            }, 3 * 1000);
            return;
            // console.log(error)
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
            reject(  err );
            console.log("error", err);
        }).catch(function(err){
            reject( err );
            console.log("error", err);
        })
    })
}


var actionHanddler = {};


var voteWriteStream = new elasticWriteStream(2, 'votetracker', 'vote');
var stakeWriteStream = new elasticWriteStream(2, 'stake', 'stake');

actionHanddler['voteproducer'] = function(data, block){
    var voter = data.voter;
    var producers = data.producers;

    data.block_num = block.block_num;
    data.timestamp = block.timestamp;

    getAccountData(voter).then(function(voterData){
        data.voterData = voterData;
        var copy = Object.assign({}, data);
        delete copy.voterData;
        voteWriteStream.write(copy);
        fs.appendFileSync(config.database.voter_log, JSON.stringify(data)+"\n");
    }, function(err){
        console.log(err);
    }).catch(function(err){
        console.log(err);
    })
}


actionHanddler['delegatebw'] = function(data, block){
    data.block_num = block.block_num;
    data.timestamp = block.timestamp;
    stakeWriteStream.write(data);
    fs.appendFileSync(config.database.all_delegatebw, JSON.stringify(data)+"\n");
}


actionHanddler['undelegatebw'] = function(data, block){
    data.block_num = block.block_num;
    data.timestamp = block.timestamp;
    stakeWriteStream.write(data);
    fs.appendFileSync(config.database.all_delegatebw, JSON.stringify(data)+"\n");
}

process.on('SIGINT', function() {
    voteWriteStream.end();
    stakeWriteStream.end();
    console.log('Got SIGINT.  Press Control-D/Control-C to exit.');
    setTimeout(() => {
        process.exit();
    }, 5 * 1000);
});

listenBlock();
