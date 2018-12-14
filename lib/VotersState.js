const TableReadStream = require('./TableReadStream');
const config = require('../config');
const Stream = require('stream');
const moment = require('moment');
const EosJs = require("eosjs");


class VotersState {

    constructor(lokijs, app){
        this.lokijs = lokijs;
        this.app = app;

        this.voters = null;
        (async () => {
            console.log('lokijs', lokijs);
            this.voters = await lokijs.getCollection('voters');
            this.init();
            this.bindRoute();
        })();
    }

    bindRoute(){
        this.app.get('/queryState', (req, res, next) => {
            var proxy = req.query.proxy;
            var voter = req.query.voter;
            var producer = req.query.producer;
            if(proxy){
                return res.json(this.getProxyVoters(proxy));
            }
            if(producer){
                return res.json(this.getProducerVoters(producer));
            }
            if(voter){
                return res.json(this.getVoter(voter));
            }
            return res.json(this.getAllProxy());
        });
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

    isProxy(proxy){
        return this.voters.findOne({
            is_proxy: 1,
            owner: proxy
        })
    }

    getVoter(owner){
        return this.voters.findOne({
            owner: owner
        })
    }

    getAllProxy(){
        var proxy = this.voters.find({
            is_proxy: 1
        })
        return proxy;
    }

    getProxyVoters(proxy){
        var proxy = this.voters.find({
            proxy: proxy
        })
        return proxy;
    }

    getProducerVoters(producer){
        var voters = this.voters.find({
            producers: { '$contains' :  producer }
        })
        return voters;
    }
}



// var stater = new VotersState(config.lokijs);
// setTimeout(() => {
//     console.log(stater.voters.findOne({
//         owner: 'funooooooooo'
//     }));
// }, 20 * 1000);


module.exports = VotersState;