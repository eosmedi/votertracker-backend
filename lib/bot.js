const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const config = require('../config');

var notifyProducer = null;

var EosApi = require('eosjs-api');
var eos = EosApi({
    httpEndpoint: "https://api.eosmedi.com",
    logger: {
        error: null,
        log: null
    }
})


var _producerRankTable = {};

function recoredProducerRank(producers){
    var time = Date.now();

    producers.forEach((producer, index) => {
        var log = {
            producer: producer.owner,
            index: index,
            time: time
        };

        _producerRankTable[producer.owner] = _producerRankTable[producer.owner] || [];
        if(_producerRankTable[producer.owner].length > 10){
            _producerRankTable[producer.owner].shift();
        }

        var recordData = _producerRankTable[producer.owner];

        if(recordData){
            var lastRank =  recordData[recordData.length - 1];
            if(lastRank && lastRank.index != index){
                // console.log('change', lastRank, log, recordData.length);
                if(notifyProducer){
                    notifyProducer(producer.owner, lastRank, index);
                }
            }
        }

        _producerRankTable[producer.owner].push(log);
        // console.log(producer.owner, index);
    })
}


function getProducerRank(){
    eos.getProducers({
        json: true,
        limit: 500
    }, (error, result) => {
        if(!error){
            recoredProducerRank(result.rows);
        }
    })
}


setInterval(() => {
    try{
        getProducerRank();
    }catch(e){
        console.log(e);
    }
}, 30 * 1000);



function TelegramBoter(server){
    var io = require('socket.io')(server);

    var clients = [];
    function notify(log){
        clients.forEach((client) => {
            if(client){
                client.emit('log', log);
            }
        })
    }


    io.on('connection', function(socket){
        console.log('a user connected');
        clients.push(socket);
        socket.on('disconnect', function(){
            clients.forEach((client, index) => {
                if(client == socket){
                    clients[index] = null;
                }
            })
            console.log('user disconnected');
        });
    });

    notifyProducer = function(producer, lastRank, index){
        var nowIndex = index+1;
        var lastIndex = lastRank.index+1;
        var diffIndex = lastIndex - nowIndex;

        var log = {
            producer: producer,
            rank: nowIndex,
            lastRank: lastIndex,
            pos: (diffIndex > 0) ? "+" : "-"
        }
        
        notify(log);
    }

    return {
        notify: (log) =>{
            try{
                notify(log)
            }catch(e){}
        }
    }
}

// var botter = new TelegramBoter();
// setInterval(() => {
//     botter.notify({
//         producer: 'eosfishrocks',
//         voter: 'XXX',
//         block_num: 1222,
//         staked: "100",
//         timestamp: ""
//     });
// }, 10  * 1000);

module.exports = TelegramBoter;
