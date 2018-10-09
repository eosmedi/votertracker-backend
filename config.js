var fs = require('fs');

var BASE_DIR = __dirname+'/database/';

if(!fs.existsSync(BASE_DIR)){
    fs.mkdirSync(BASE_DIR);
}

var config = {
    httpEndPoint: 'http://api.eosmedi.com',
    database: {
        proxy_info: BASE_DIR+'proxyInfo.json',
        voter_log: BASE_DIR+'voter.log',
        bpinfos: BASE_DIR+'bpinfos.json',
        all_delegatebw: BASE_DIR+'all_delegatebw.log',
        vote_check_point_file: BASE_DIR+'fetched',
        stake_check_point_file: BASE_DIR+'delegatebw_fetched',
    }
};

module.exports = config;