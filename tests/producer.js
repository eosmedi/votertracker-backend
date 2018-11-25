var EosApi = require('eosjs-api');
var eos = EosApi({
    httpEndpoint: config.httpEndPoint,
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
}, 60 * 1000);
