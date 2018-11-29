const config = require('../config');
var EosApi = require('eosjs-api');
var fs = require('fs');
var moment = require('moment');

var eos = EosApi({
    httpEndpoint: config.httpEndPoint,
    logger: {
        error: null,
        log: null
    }
})

var _producerRankTable = {};
if(fs.existsSync(config.database.producer_hitory)){
    try{
        _producerRankTable = JSON.parse(fs.readFileSync(config.database.producer_hitory));
    }catch(e){}
}

function producerRankRecorder(votedProducers){
    var interval = 86400 * 1000;
    function recoredProducerRank(producers){
        var time = moment();

        producers.forEach((producer, index) => {
            var log = {
                index: index + 1,
                time: time,
                total_votes: producer.total_votes,
                voters: 0
            };

            if(votedProducers[producer.owner]){
                log.voters = Object.keys(votedProducers[producer.owner]['voters']).length;
            }

            _producerRankTable[producer.owner] = _producerRankTable[producer.owner] || [];
            var recordData = _producerRankTable[producer.owner];

            if(recordData.length > 20){
                recordData.shift();
            }

            if(recordData){
                var lastRank =  recordData[recordData.length - 1];
                if(lastRank){
                    var timeLeft = time - moment(lastRank.time);
                    if(timeLeft > interval){
                        console.log('record rank')
                    }else{
                        console.log('wait next day', timeLeft);
                        return;
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
                console.log('recoredProducerRank')
                try{
                recoredProducerRank(result.rows);
                    fs.writeFileSync(config.database.producer_hitory, JSON.stringify(_producerRankTable));
                }catch(e){
                    console.log(e);
                }
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


    return {
        getRankHistory:  function(producer){
            var history = _producerRankTable[producer] || [];
            history = [].concat(history);
            var data =  history.filter((p) => {
                if(!p.time){
                    console.log(p);
                    return false;
                }
                var f = true;
                if(p.time.indexOf('2018-11-23') > -1){
                    f = false;
                }
                if(p.time.indexOf('2018-11-24') > -1){
                    f = false;
                }
                return f;
            })

            return data;
            // return _producerRankTable[producer];
        }
    }
}



// new producerRankRecorder();

module.exports = producerRankRecorder;
