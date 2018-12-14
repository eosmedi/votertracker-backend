const TableReadStream = require('./TableReadStream');
const config = require('../config');
const Stream = require('stream');
const moment = require('moment');
const EosJs = require("eosjs");


class VotersState {

    constructor(lokijs){
        this.lokijs = lokijs;

        this.voters = null;
        (async () => {
            console.log('lokijs', lokijs);
            this.voters = await lokijs.getCollection('voters');
            this.init();
        })();
    }

    init(){

        this.read =  new TableReadStream({
            account: 'eosio',
            scope: 'eosio',
            table: 'voters',
            indexKey: 'owner'
        });

        this.write = Stream.Writable({
            objectMode: true,
            write: (row, _, next) => {
                this._onRow(row, _, next);
            }
        })
        
        this.read.pipe(this.write);
        this.read.on('end', () => {
            console.log('reader end');
        });
    }

    _onRow(row, _, next){
        var existVoter = this.voters.findOne({
            owner: row.owner
        });
        if(existVoter) {
            existVoter = Object.assign(existVoter, row);
            this.voters.update(existVoter)
        }else{
            this.voters.insert(row);
        }
        process.nextTick(next);
    }
}



var stater = new VotersState(config.lokijs);


module.exports = VotersState;