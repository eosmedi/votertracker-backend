var EosApi = require('eosjs-api');
var Promise = require('promise');
var request = require('request');
var fs = require('fs');
var config = require('../config.js');

eos = EosApi({
    httpEndpoint: config.httpEndPoint
})

var producers = [];
(function loop(){
    var producer = producers.shift();

    if(!producer){
        getAllProducers();
        setTimeout(() => {
           loop(); 
        }, 50);
    }else{
        parseBblockProducerInfo(producer).then(function(){
            loop(); 
        })
    }
})();


var producerInfoTable = {};


try{
    producerInfoTable = JSON.parse(fs.readFileSync(config.database.bpinfos, "utf-8"))
}catch(e){
    producerInfoTable = {};
}

function setProducerInfo(producer, bpInfo){
    bpInfo.update_time = Date.now();
    producerInfoTable[producer] = bpInfo;
}


setInterval(function(){
    fs.writeFileSync(config.database.bpinfos, JSON.stringify(producerInfoTable));
}, 100 *1000);



function parseBblockProducerInfo(producer){
    return new Promise(function(resolve, reject){

        if(producer.url.indexOf(".json") > -1){
            var producerInfoLink = producer.url;
        }else{
            var producerInfoLink = producer.url+'/bp.json';
            producerInfoLink = producerInfoLink.replace("//bp.json", "/bp.json");
        }
       
        console.log(producerInfoLink);
        request.get(producerInfoLink, { timeout: 10000 }, function(err, httpResponse, body){
            var errorCaptured = false;
            try{
                body = JSON.parse(body.trim());
            }catch(e){
                errorCaptured = true;
		        //console.log(producerInfoLink, e);
            }
            var bpData = {};
            if(errorCaptured){
                bpData.not_found = true;
            }else{
                bpData = body;
            }

            setProducerInfo(producer.owner, bpData);
            resolve();
        })
    })
}


function getAllProducers(){
    eos.getProducers({
        json: true,
        limit: 500
    }, (error, result) => {
        result.rows.forEach(function(row, index){
            row.index = index;
            producers.push(row);
        })
    })
}
