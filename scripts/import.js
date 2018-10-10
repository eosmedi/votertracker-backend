
const elastic = require('../lib/elastic');
const Promise = require('promise');
const getFileStreamer = require('../lib/filestreamer');
const config = require('../config');
const elasticWriteStream = require('../lib/elasticWriteStream');



function importData(job, client, index, type){
    return new Promise((resolve, reject) => {
        var readStream = getFileStreamer(job.file);
        var writeStream = new elasticWriteStream(100, index, type);
        readStream.pipe(writeStream);
        readStream.on('end', function () {
            writeStream.end();
            console.log(job, 'done')
            resolve();
        })
    })
}


function importVote(job, client){
    return importData(job, client, 'votetracker', 'vote');
}

function importStake(job, client){
    return importData(job, client, 'stake', 'stake');
}

async function runJobs(jobs, client){
    for (let index = 0; index < jobs.length; index++) {
        const job = jobs[index];
        if(job.type == "vote"){
            await importVote(job, client);
        }else{
            await importStake(job, client);
        }
    }
}


(async () => {
    const client = await elastic.getClient();
    var jobs = [];
    jobs.push({
        type: 'vote',
        file: config.database.voter_log
    })

    jobs.push({
        type: 'stake',
        file: config.database.all_delegatebw
    })

    await runJobs(jobs, client);
    console.log('all done')
})();