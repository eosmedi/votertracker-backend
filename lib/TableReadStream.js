const Stream = require('stream');
const fs = require('fs');
const config = require('../config');
const EosApi = require('eosjs-api');
const EosJs = require("eosjs");
const moment = require('moment');
const bigInt = require('big-integer');

class TableReadStream extends Stream.Readable {
    constructor(opts){
        super();
        this.opts = opts || {}; 
        this.account = opts.account || '';
        this.table = opts.table || '';
        this.scope = opts.scope || '';
        this.indexKey = opts.indexKey || '';
        Stream.Readable.call(this, {
            objectMode: true,
            highWaterMark: opts.highWaterMark || 1000
        });

        this.nextKey = 0;
        this.done = false;
        this.querying = false;
        this.initClient();
    }

    initClient(){
        this.eosClient = EosJs({
            httpEndpoint: config.httpEndPoint,
            logger: {
                error: null,
                log: null
            }
        });
    }

    _read(){

        var self = this;
        if(this.querying){
            return;
        }

        if(this.done){
            console.log('done and restart');
            // reset
            this.nextKey = 0;
            this.done = false;
        }

        (async () => {
            try{
                console.log('query')
                this.querying = true;
                var data = await this.eosClient.getTableRows({
                    json: true,
                    code: this.account,
                    scope: this.scope,
                    table: this.table,
                    table_key: "",
                    limit: 500,
                    lower_bound: this.nextKey,
                    upper_bound: -1
                });
                this.querying = false;
                var lastName = '';
                data.rows.forEach((d) => {
                    lastName = d[this.indexKey];
                    self.push(d);
                })
               
                if(data.more){
                    var nameIndex = EosJs.modules.format.encodeName(lastName, false);
                    console.log(lastName, nameIndex)
                    this.nextKey = bigInt(nameIndex).add(1);
                }else{
                    this.done = true;
                }
            }catch(e){
                console.log(e);
                this.querying = false;
            }
        })();
    }
}
;



// var testStream = new TableReadStream({
//     account: 'eosio',
//     scope: 'eosio',
//     table: 'voters',
//     indexKey: 'owner'
// });

// testStream.pipe(Stream.Writable({
//     objectMode: true,
//     write: (row, _, next) => {
//         console.log(row);
//         next();
//     }
// }))


module.exports = TableReadStream;