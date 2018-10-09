var EosApi = require('eosjs-api');
var Promise = require('promise');
var request = require('request');
var fs = require('fs');
var config = require('../config.js');

var eos = EosApi({
    httpEndpoint: config.httpEndPoint
})

var defaultInfo = {
    "dutcheosprox": {
        "time": "2018/07/08 6:51:11 下午 GMT+8",
        "account": "dutcheosprox",
        "fullName": "DutchEOS Proxy",
        "slogan": "Quality Independent BPs under 1%",
        "philosophy": "You won’t find any of the most-voted-for producers on our list. Popularity of BP’s is a self-enforcing cycle; by voting for our curated selection of top BP’s you help breaking that cycle and make EOS stronger. We aim to endorse only candidates with high ethical standards, who are technically capable, have block producing as their primary business, are independent of large interests, who contribute to the health of the ecosystem, but remain mostly undiscovered by voters.",
        "url": "https://dutcheos.io/best-eos-block-producers/",
        "telegram": "https://t.me/DutchEOS",
        "background": "DutchEOS proxy is an initiative of BP DutchEOS. Selection of the BPs for the proxy is regularly updated. The KPIs and final selection is updated on our website. Please do contact us for any suggestions you may have to improve the selection.",
        "logo": "https://dutcheos.io/assets/dutcheos_1024.png",
        "location": "Netherlands"
    },
    "detroitproxy": {
        "time": "2018/07/08 9:27:11 下午 GMT+8",
        "account": "detroitproxy",
        "fullName": "EOS Detroit BP Voting Slate",
        "slogan": "Towards a decentralized and prosperous EOS.",
        "philosophy": "Votes are allocated to active standby and backup BPs that we consider undervalued. Allocating the vote to nodes outside of the top 21 means that we can achieve a wider distribution, hiring more active teams as paid contributors.",
        "url": "https://steemit.com/eos/@eos.detroit/eos-detroit-voting-slate",
        "telegram": "https://t.me/eos_detroit",
        "background": "Maintained by the EOS Detroit block producer team.",
        "logo": "https://eosdetroit.io/images/logo-black.png",
        "location": "Detroit, Michigan, USA"
    },
    "ottomagiceos": {
        "time": "2018/07/08 11:03:51 下午 GMT+8",
        "account": "ottomagiceos",
        "fullName": "Otto",
        "slogan": "For a healthy, reliable and fair network",
        "philosophy": "Aspects I look for in BPCs include 1) active engagement in the community, 2) reliable block production, 3) ownership disclosed & preferably self funded, 4) profits used for common good, 5) no exchanges in order to avoid concentration of power. For maximum impact towards having desired candidates in the set of 21 producers I vote with a full list of candidates and don't spend my votes towards producers that have already made it to the top 21.",
        "url": "",
        "telegram": "ottomagic",
        "background": "I'm an EOS enthusiast trying to keep up with what's happening in the community. By being a proxy I want to make my effort available for others to use as well. I know most people don't have time to really follow everything to make informed decisions.",
        "logo": "",
        "location": ""
    },
    "investingwad": {
        "time": "2018/07/08 11:03:51 下午 GMT+8",
        "account": "investingwad",
        "fullName": "Investing with a Difference",
        "slogan": "",
        "philosophy": "community engagement and participatio",
        "url": "http://www.youtube.com/c/investingwithadifference",
        "telegram": "https://t.me/joinchat/IQFgLQ2CT5Uc8rPV6WrfPQ",
        "background": "",
        "logo": "",
        "location": ""
    }
}


var proxyInfoTable = {};

function fetchProxyInfo(){

    eos.getTableRows({
        json: true, 
        code: "regproxyinfo", 
        scope: "regproxyinfo",
        table: "proxies",
        table_key: "", 
        limit: 500
    },
    (error, result) => {
        result.rows.forEach(function(row){
            var proxy = row.owner;
            var def = defaultInfo[proxy] || {};
    
            var data = {
                "account" : proxy,
                "fullName" : proxy.name,
                "slogan" :  proxy.slogan,
                "url" :  proxy.website,
            }
    
            var data = {
                "account" : proxy,
                "fullName" : row.name,
                "slogan" :  row.slogan,
                "philosophy": row.philosophy || def.philosophy,
                "url": row.website,
                "telegram": row.telegram,
                "background": row.background || def.background,
                "logo": row.logo_256,
                "location": def.location || ""
            }
   		for(var key in row){
                if(!data[key]){
                    data[key] = row[key];
                }
            } 
            proxyInfoTable[proxy] = data;
        })

        for(var key in defaultInfo){
            if(!proxyInfoTable[key]){
                proxyInfoTable[key] = defaultInfo[key];
            }
        }
    
        console.log(proxyInfoTable);
        fs.writeFileSync(config.database.proxy_info, JSON.stringify(proxyInfoTable));
    })
}


setInterval(function(){
 try{
    fetchProxyInfo();
 }catch(e){
    console.log(e);
 }
}, 100 * 1000)
