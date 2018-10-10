
const elasticsearch = require('elasticsearch');
const config = require('../config');

let _client = null;


const getClient = async (query) => {
    if(_client == null){
        _client = await new elasticsearch.Client({
            host: config.elasticsearch,
        });
    }
    return _client;
}



module.exports = {
    getClient: getClient
}