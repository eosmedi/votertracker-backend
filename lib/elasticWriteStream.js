const elastic = require('../lib/elastic');
const crypto = require('crypto');
var Stream = require('stream');


function md5(str){
    return crypto.createHash('md5').update(str).digest('hex');
}

function elasticWriteStream(batchSize, index, type){
    var batch = [];
    // write data
    async function write(){
        var client = await elastic.getClient();
        var body = [];
        if(!batch.length){
            return;
        }

        batch.forEach((piece) => {
            var hash = md5(JSON.stringify(piece));
            body.push({ 
                index: { 
                    _index: index, 
                    _type: type,
                    _id: hash
                }
            })
            body.push(piece);
        })
        batch = [];
        try{
            var setResults = await client.bulk({
                body: body
            })
            // console.log('results', setResults)
        }catch(e){
            throw e;
            // console.log(e, body);
        }
    }


    var batch = [];

    var writable = Stream.Writable({
        objectMode: true,
        write: function(line, _, next) {
            if(batch.length > batchSize){
                (async () => {
                    await write();
                    console.log('write done');
                    process.nextTick(next);
                })();
            }else{
                batch.push(line);
                process.nextTick(next)
            }
        }
    })

    writable.on('finish', () => {
        // console.log('finish')
        (async () => {
            await write();
            console.log('finish done');
        })();
    })

    return writable;
}


module.exports = elasticWriteStream;