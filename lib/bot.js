const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

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



function TelegramBoter(){

    var token = '682228895:AAFG6Cb2qS-L7cDOxsgfbYlpq0qyPRg8swg';
    var bot = new TelegramBot(token, {polling: true});
    var file = 'bot_watcher.json';
    var _watcher = {};

    if(fs.existsSync(file)){
        try{
            _watcher = JSON.parse(fs.readFileSync(file, 'utf-8'));
        }catch(e){
            _watcher = {};
        }
    }

    console.log('_watcher', _watcher)

    function newWatcher(type, chatId, value, isRemove){
        if(!value) return;
        value = value.trim();

        var directives = {};
        var extract = value.split(" ");
        if(extract.length > 1){
            value = extract.shift();
            extract.forEach((directive) => {
                directive = directive.split("=");
                directives[directive[0]] = directive[1]
            })
        }

        var threshold =  10000;
        if(directives.threshold){
            try{
                threshold = parseInt(directives.threshold);
            }catch(e){
                threshold = 10000;
            }
        }

        if(isRemove){
            if(_watcher[type] && _watcher[type][value]){
                delete _watcher[type][value][chatId];
            }
            return 'unwatch '+type+"="+value;
        }else{
            console.log(type, chatId, value);
            _watcher[type] = _watcher[type] || {};
            _watcher[type][value] = _watcher[type][value] || {};
            _watcher[type][value][chatId] = threshold;
            console.log(_watcher);
            return 'watch '+type+"="+value +" threshold="+threshold;
        }
    }

    (function loop(){
        fs.writeFileSync(file, JSON.stringify(_watcher));
        setTimeout(() => {
            loop();
        }, 30 * 1000)
    })();

    bot.onText(/\/producer (.+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const resp = match[1];
        bot.sendMessage(chatId, newWatcher('producer', chatId, resp));
    });

    bot.onText(/\/proxy (.+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const resp = match[1];
        bot.sendMessage(chatId, newWatcher('proxy', chatId, resp));
    });


    bot.onText(/\/producer_unwatch (.+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const resp = match[1];
        bot.sendMessage(chatId, newWatcher('producer', chatId, resp, true));
    });

    bot.onText(/\/proxy_unwatch (.+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const resp = match[1];
        bot.sendMessage(chatId, newWatcher('proxy', chatId, resp, true));
    });

 bot.onText(/\/start/, (msg, match) => {
        const chatId = msg.chat.id;
        const resp = match[1];
        bot.sendMessage(chatId, "You can control me by sending these commands:\n\n/producer {target} threshold={threshold} - "+
        "subscribe producer voters change\n"+
        "example: /producer eosmedinodes threshold=10000 "+"\n\n"+
        "/proxy {target} threshold={threshold} - "+
        "subscribe proxy voters change\n"+
        "example: /proxy lukeeosproxy threshold=10000 \n\n"+
        "/producer_unwatch {target} - unsubscribe\n"+
        "/proxy_unwatch {target} - unsubscribe\n"+
        "\n\n");
    });

    function notify(log){
        var type = 'producer';
        if(log.proxy) type = 'proxy';
        var typeValue = log[type];
        var voterStaked = log.staked / 10000;

        if(log.lastRank){
            var message = typeValue+" rank changed from "+log.lastRank +" to "+log.rank;
        }else{
            var message = [
                log.voter+' -> ',
                    type == 'producer' ?
                        log.action ==  "add" ? '[vote producer] -> ' : '[remove producer] -> ' :
                    log.action ==  "add" ? '[set proxy] -> ' : '[remove proxy] -> ',
                '['+typeValue+']',
                "staked="+(log.staked / 10000).toFixed(2)+' EOS'
            ].join(" ");
            console.log(message)
        }

        if(_watcher[type] && _watcher[type][typeValue]){
            Object.keys(_watcher[type][typeValue]).forEach((chatId) => {
                var threshold = _watcher[type][typeValue][chatId];
                if(log.lastRank){
                    bot.sendMessage(chatId, message);
                }else{
                    if(voterStaked >= threshold){
                        bot.sendMessage(chatId, message);
                    }else{
                        console.log('threshold limit');
                    }
                }
            })
        }
    }

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
