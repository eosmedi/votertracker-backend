var app = require('express')();
cluster = require('cluster'),
os = require("os"),
fs = require("fs"),
moment = require('moment'),
numCPUs = require('os').cpus().length;


var server = require('http').createServer(app);

var searchApi = require('./search');

app.disable('x-powered-by');

var config = require('./config');
var compression = require('compression');
var EosApi = require('eosjs-api');
var Promise = require('promise');
var TelegramBoter = require('./lib/bot.js');
var producerRankRecorder = require('./lib/producerRankHistory.js');
var voterScanner = require('./lib/votersScanner.js');
var VotersState = require('./lib/VotersState.js');



var ENABLE_SELFBUILD_STATE = false;

var botter = new TelegramBoter(server);
var stater = new VotersState(config.lokijs, app);
// setInterval(() => {
//     botter.notify({
//         producer: 'eosfishrocks',
//         voter: 'XXX',
//         block_num: 1222,
//         staked: "100",
//         timestamp: ""
//     });
// }, 10  * 1000);

eos = EosApi({
  httpEndpoint: config.httpEndPoint,
  logger: {
  }
})


app.use(function (req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  res.setHeader('Access-Control-Allow-Credentials', true);
  next();
});

function getAccountData(account){
  return new Promise(function(resolve, reject){
      Promise.all([
          eos.getAccount({
              account_name: account
          }),
          eos.getCurrencyBalance({
              code: "eosio.token",
              account: account
          })
      ]).then(function(res){
          res[0].blance = res[1];
          resolve(res[0])
      }, function(err){
          reject(err);
          console.log("error", err);
      }).catch(function(err){
          reject(err);
          console.log("error", err);
      })

      setTimeout(function(){
          reject('fech '+account+' account timeout');
      }, 10 * 1000);
  })
}


function calculateVoteWeight(date) {
	if(typeof date == "string"){
		 date = moment.utc(date);
	}
	date = date || Date.now();
	var timestamp_epoch = 946684800000;
	var dates_ = (date / 1000) - (timestamp_epoch / 1000);
	var weight_ = Math.ceil(dates_ / (86400 * 7)) / 52;
	return Math.pow(2, weight_);
}

function voteDecayDetal(stake, lastTime, time){
    if(typeof lastTime == "string"){
        lastTime = moment.utc(lastTime);
    }

    if(typeof time == "string"){
        time = moment.utc(time);
    }

    var lastWeight = calculateVoteWeight(lastTime);
    var lastVotesWeight = stake * lastWeight;
    var nowWeight = calculateVoteWeight(time);
    var nowVotesweight = stake * nowWeight;
    var voteDecayDetal = (nowVotesweight - lastVotesWeight) / lastVotesWeight * 100;
    // console.log(nowVotesweight - lastVotesWeight, lastVotesWeight, lastWeight, nowWeight)
    return parseFloat(voteDecayDetal.toFixed(2))
}


var votedProducers = {};
var allVoters = {};
var votersInfo = {};
var voterLogs = [];
var proxyVoters = {};
var totalProxyedVotes = 0;

var snapshotData = {};
var tableFile = config.database.bpinfos;
var proxyTableFile = config.database.proxy_info;

var producerInfoTable = {};
var tokenStats = {};
var stakedLogs = [];

var stakeLogsLimit = 100;

var producerRanker = new producerRankRecorder(votedProducers);
var voterScannerRunner = new voterScanner(allVoters);


function updateCurrencyStats(){
  eos.getCurrencyStats({
      code: "eosio.token",
      symbol: "EOS"
  }).then(function(stats){
      tokenStats = stats;
  })
}


updateCurrencyStats();

setInterval(function(){
  try{
      updateCurrencyStats();
  }catch(e){

  }
}, 20)


function loadBpInfos(){
  try{
      producerInfoTable = JSON.parse(fs.readFileSync(tableFile, "utf-8"))
  }catch(e){
      producerInfoTable = {};
  }
}

loadBpInfos();

fs.watch(tableFile, function(){
  console.log("bpinfos change");
  loadBpInfos();
})

var proxyinfoTable = {};


function loadProxyInfos(){
  try{
      proxyinfoTable = JSON.parse(fs.readFileSync(proxyTableFile, "utf-8"))
  }catch(e){
      proxyinfoTable = {};
  }
}

loadProxyInfos();

fs.watch(proxyTableFile, function(){
  console.log("proxyTableFile change");
  loadProxyInfos();
})


try{
  var _snapshotData = fs.readFileSync(config.database.snapshot, "utf-8");
  snapshotData = JSON.parse(_snapshotData);
}catch(e){
}


function loadFromFile(){
  try{
      var _data = fs.readFileSync("database.json", "utf-8");
      _data = JSON.parse(_data);
      if(_data.votedProducers){
          votedProducers = _data.votedProducers;
      }

      if(_data.allVoters){
          allVoters =  _data.allVoters;
      }
  }catch(e){}
}


function loadVoterInfoFromFile(){
  try{
      var _votersInfo = fs.readFileSync(config.database.voters_info, "utf-8");
      _votersInfo = JSON.parse(_votersInfo);
      if(_votersInfo){
          votersInfo = _votersInfo;
      }
  }catch(e){}
}


loadVoterInfoFromFile();

var updateVotersList = [];

function loadVoterData(){
  (function Loop(){
      var voter = updateVotersList.shift();

      if(!voter){
          setTimeout(function(){
              Loop();
          }, 10 * 1000);
          return;
      }

      if(typeof voter !== "string"){
          voter = voter.account_name;
      }

      console.log('loadVoterData', updateVotersList.length);
      if(!votersInfo[voter]){
          console.log("updateVotersList load voter info", voter)
          getAccountData(voter).then(function(data){
              votersInfo[voter] = data;
              votersInfo[voter].update_time = Date.now();
              console.log("voter info updated", data);
              Loop();
          }, function(err){
              console.log(err);
          }).catch(function(err){
              console.log(err);
          })
      }else{
          setTimeout(function(){
              Loop();
          }, 50);
      }

  })();
}


var needUpdateVoterTable = {};

function freshVoterInfo(){

  var lastFetchTime = Date.now();
  var votersList = Object.keys(needUpdateVoterTable);

  function getVoters(){
      return Object.keys(needUpdateVoterTable);
  }

  function getSize(){
      return getVoters().length;
  }

  function isRunning(){
      return !((Date.now() - lastFetchTime) > 3600000);
  }

  function getListSize(){
      return votersList.length;
  }

  function fetchData(){
      var voter = votersList.shift();
      if(!voter){
          setTimeout(function(){
              lastFetchTime =  Date.now();
              console.log("freshVoterInfo quee", Date.now());
              try{
                votersList = Object.keys(needUpdateVoterTable);
                fetchData();
              }catch(e){
                console.log("freshVoterInfo", e);
              }
          }, 10 * 1000);
          return;
      }

      lastFetchTime =  Date.now();
      console.log("needUpdateVoterTable", votersList.length);
      try{
          getAccountData(voter).then(function(data){
              votersInfo[voter] = data;
              votersInfo[voter].update_time = Date.now();
              console.log("voter info updated", voter);
              delete needUpdateVoterTable[voter];
              fetchData();
          }, function(err){
              console.log(err);
              fetchData();
          }).catch(function(err){
              fetchData();
              console.log(err);
          })
      }catch(e){
          console.log("freshVoterInfo", e);
          fetchData();
      }
  }

  function start(){
      try{
          fetchData();
      }catch(e){
          console.log('freshVoterInfo', 'fetchData', e)
      }
  }

  return {
      getSize: getSize,
      getListSize: getListSize,
      getListSize: getListSize,
      isRunning: isRunning,
      start: start
  }
}




var infoPuller = new freshVoterInfo();

infoPuller.start();


function tryRefreshVoterInfo(){
  var refreshVoters = [];
  Object.keys(votersInfo).forEach(function(voter){
      if(voterInfoIsTimeout(voter)){
          refreshVoters.push(voter);
          needUpdateVoterTable[voter] = 1;
      }
  })
  return refreshVoters;

}



function voterInfoIsTimeout(voter){
  if(votersInfo[voter]){
      if(!votersInfo[voter].update_time){
          return true;
      }
      var timeLeft = Date.now() - votersInfo[voter].update_time;
      if(timeLeft > 60000){
          return true;
      }
  }
  return false;
}


function updateVoterInfo(voter){
  getAccountData(voter).then(function(data){
      votersInfo[voter] = data;
      votersInfo[voter].update_time = Date.now();
      console.log("voter info updated", voter);
  }, function(err){
      console.log(err);
  }).catch(function(err){
      console.log(err);
  })
}


loadVoterData();

setInterval(function(){
  console.log("output voterinfo database");
  try{
      console.log('freshVoterInfo size', infoPuller.getSize(), 'isRunning', infoPuller.isRunning(), 'queen', infoPuller.getListSize())
      if(!infoPuller.isRunning()){
          console.log('freshVoterInfo restart');
          infoPullerr.start();
      }
  }catch(e){
      console.log("freshVoterInfo", e)
  }
  console.log("votersInfo", Object.keys(votersInfo).length);
  console.log("allVoters",  Object.keys(allVoters).length);
  fs.writeFileSync(config.database.voters_info, JSON.stringify(votersInfo));
}, 120 * 1000);


var allProducersMap = {};
var chainState = {};

function swapProducerVoters(producers){
  var votesToRemove = 0, topTotalVote = 0;
  producers.rows.forEach(function(row, index){
      var producer = row.owner;
      row.index = index+1;

      if(votedProducers[row.owner]){
          row.voters = Object.keys(votedProducers[row.owner]['voters']).length;
          row.votes_loss = votedProducers[row.owner]['votes_loss'];

          var bpinfo = producerInfoTable[producer];
          if(bpinfo && bpinfo.org){
              row.candidate_name = bpinfo.org.candidate_name;
              row.branding = bpinfo.org.branding;
              row.org_location = bpinfo.org.location;
          }
          delete row['producer_key'];
          allProducersMap[row.owner] = row;
      }

      try{
          if(row.index <= 55){
              topTotalVote += parseFloat(row.total_votes);
          }

          200 * (row.total_votes / chainState.total_producer_vote_weight * 100) < 100 && (
              votesToRemove += parseFloat(row.total_votes)
          );
      }catch(e){
          console.log("reward remove", e)
      }

      
        try{
            var rankHistory = producerRanker.getRankHistory(row.owner);
            row.history = rankHistory;
        }catch(e){
            row.history = [];
            console.log("row.history", e)
        }

  })






  if(false){
      producers.rows.forEach(function(producer, index){
          try{
              var o, u = 0;
              producer.index < 22 && (u += 318),
              u += producer.total_votes / (chainState.total_producer_vote_weight - votesToRemove) * 100 * 200;
              if(u < 100){
                  u = 0;
              }
                  producer.rewards = u.toFixed(0);
          }catch(e){
                  console.log("reward", e)
          }
      })
  }


  producers.rows.forEach(function(producer, index){
      try{
          var supply = tokenStats.supply || "1005301189.2173 EOS";
          producer.rewards = getRewards(topTotalVote, producer, supply);
      }catch(e){
          console.log("reward", e)
      }
  })

  return producers.rows;
}


function getRewards(e, t, maxSupply){
  var n = .0098 * parseFloat(maxSupply) / 365
  , r = .25 * n
  , o = r / 21
  , a = (n - r) * (t.total_votes / e)
  , i = void 0;
  if (t.index <= 21)
  i = o + a;
  else {
      if (!(a >= 100))
          return 0;
      i = a
  }
  return i.toFixed(0);
}


function pagination (pageNo, pageSize, array) {
  --pageNo;
  return array.slice(pageNo * pageSize, (pageNo + 1) * pageSize);
}


function loadProducers(){
  eos.getProducers({
      json: true,
      limit: 500
  }, (error, result) => {
      if(!error){
          swapProducerVoters(result);
      }
  })
}

loadProducers();


var cacheAllProducers = null;

app.get('/getProducers', function(req, res, next){
  var page = req.query.p || 1;
  var size = req.query.size || 70;

  console.log('getProducers')

  eos.getProducers({
      json: true,
      limit: 500
  }, (error, result) => {
      console.log('getProducers end', result);
      if(!error){
          var allProducers = swapProducerVoters(result);
          var total = allProducers.length;
          var rows = pagination(page, size, allProducers);
          res.json({
              rows: rows,
              total: total
          });
      }else{
          res.json({ error: error });
      }

  })
});


app.get('/allProxy', function(req, res, next){
  res.json(proxyVoters);
});


function getVoters(allVoters, isProxy) {
  var voters = Object.keys(allVoters);
  var arr = [];

  voters.forEach(element => {
        var cacheData = votersInfo[element];
        if(cacheData) {
            var vinfo = getVoterInfo(element, true);
            vinfo.last_vote_time = allVoters[element];
            arr.push(vinfo);
        }
  });

  arr.sort(function(i1,i2){
      var value2 = parseInt(i1.voter_info.staked);
      var value1 =  parseInt(i2.voter_info.staked);
      if (value1 < value2) {
          return -1;
      } else if (value1 > value2) {
          return 1;
      } else {
          return 0;
      }
  });

  if(isProxy){
      var totalProxyVotes = 0;
      arr.forEach(function(proxyData){
          var a = parseInt(proxyData.voter_info.proxied_vote_weight);
          
          totalProxyVotes += proxyData.voter_info.staked
      })
      totalProxyedVotes = totalProxyVotes;
  }

  return arr;
}

app.get('/getVoters', function(req, res, next){
  var page = req.query.p || 1;
  var size = req.query.size || 50;
  var data = getVoters(allVoters);
  var rows = pagination(page, size, data);
  res.json({
      rows: rows,
      total: Object.keys(allVoters).length
  });
});


app.get('/tryRefreshVoterInfo', function(req, res, next){
  res.json(tryRefreshVoterInfo());
});




function getVoterStakedFromLocalState(voter){
    if(ENABLE_SELFBUILD_STATE){
        var state = {};
        var voterStakedFromSate = voterStakeState[voter];
        if(voterStakedFromSate){
            state = Object.assign(state, voterStakedFromSate);
            var voterTotalStaked = voterStakedFromSate.total + voterStakedFromSate.to_others.total;
            state.staked = voterTotalStaked * 10000;
            return state;
        }
    }else{
        var voterStateIn = voterScannerRunner.getVoterState(voter);
        if(voterStateIn){
            console.log('voterStateIn', voterStateIn);
            return {
                staked: parseInt(voterStateIn.staked)
            }
        }
    }
}



function getVoterInfo(voter, missLoadCache){
  var cacheData = votersInfo[voter];

  if(!missLoadCache && voterInfoIsTimeout(voter)){
      updateVoterInfo(voter);
  }

  if(!cacheData){
      needUpdateVoterTable[voter] = 1;
  }

  if(cacheData && snapshotData[cacheData.account_name]){
      votersInfo[voter].snapshot = snapshotData[cacheData.account_name];
      votersInfo[voter].eth = votersInfo[voter].snapshot.eth;
  }

  if(cacheData && allVoters[voter]){
      votersInfo[voter].actions = [].concat(allVoters[voter]['actions']);
  }


  var voterStakedFromSate = getVoterStakedFromLocalState(voter);

    // var voterStakedFromSate = voterStakeState[voter];
    if(cacheData && voterStakedFromSate){
        var voterStakedEos = cacheData.voter_info.staked;
        // make sure stake is  not negative
        if(voterStakedFromSate && voterStakedFromSate.staked > 0){
            // var voterTotalStaked = voterStakedFromSate.cpu + voterStakedFromSate.net;
            // cacheData.voter_info.staked = voterTotalStaked * 10000;
            cacheData.voter_info.staked = voterStakedFromSate.staked;
        }
    }

  var voterIsProxy = proxyVoters[voter];
  if(voterIsProxy){
      var proxyStacked = 0;
      var proxyAllVoters =  Object.keys(proxyVoters[voter]["voters"]);
      var allVotersProxy = [];

      proxyAllVoters.forEach(function(proxyVoter){
          var proxyVoterInfo = votersInfo[proxyVoter];
          var timestamp = proxyVoters[voter]["voters"][proxyVoter];
          if(!proxyVoterInfo){
              needUpdateVoterTable[proxyVoter] = 1;
              console.log("proxyVoter info miss", proxyVoter, Date.now())
              return;
          }

         //  var stakedFromSate = voterStakeState[proxyVoter];
            var stakedEos = parseInt(proxyVoterInfo.voter_info.staked);
            
            // make sure stake is  not negative
            var voterStakedFromSate = getVoterStakedFromLocalState(proxyVoter);
            if(voterStakedFromSate && voterStakedFromSate.staked > 0){
                stakedEos = voterStakedFromSate.staked;
            }

            if(stakedEos < 0){
                stakedEos = parseInt(proxyVoterInfo.voter_info.staked);
            }

         //  if(stakedFromSate){
         //      var totalStaked = stakedFromSate.cpu + stakedFromSate.net;
         //      stakedEos = totalStaked * 10000;
         //  }

          proxyStacked += stakedEos;
          allVotersProxy.push({
              voter: proxyVoter,
              staked: stakedEos,
              timestamp: timestamp
          })
      })

      if(cacheData){
          votersInfo[voter].proxy_voters = proxyAllVoters;
          votersInfo[voter].all_proxy_voters = allVotersProxy;
          votersInfo[voter].voter_info.staked = proxyStacked;
      }
  }

  if(!cacheData){
      console.log(cacheData, voter);
  }

  return votersInfo[voter];
}





app.get('/getVoter/:voter', function(req, res, next){
  var voter = req.params.voter;
  var voterData = getVoterInfo(voter, false);
  if(voterData && proxyinfoTable[voter]){
    voterData.info = proxyinfoTable[voter];
  }

  var data = Object.assign({}, voterData);
  var voterIsProxy = proxyVoters[voter];
  if(voterIsProxy){
    var addLogsData = getVoterLogsInfo(proxyVoters[voter]["addLogs"]);
    var removeLogsData = getVoterLogsInfo(proxyVoters[voter]["removeLogs"]);
    data.addLogs = addLogsData.data;
    data.removeLogs = removeLogsData.data;
    data.stakeLogs = proxyVoters[voter]["stakeLogs"];
    data.total = {
        add: addLogsData.total,
        remove: removeLogsData.total,
        diff: addLogsData.total - removeLogsData.total
    }
  }
  res.json(data);
});


function cacluteProducerVotesLoss(){
  Object.keys(votedProducers).forEach(function(votedProducer){
      var addLogsData = getVoterLogsInfo(votedProducers[votedProducer]["addLogs"]);
      var removeLogsData = getVoterLogsInfo(votedProducers[votedProducer]["removeLogs"]);
      var voteLoss =  {
          add: addLogsData.total,
          remove: removeLogsData.total,
          diff: addLogsData.total - removeLogsData.total
      }

      votedProducers[votedProducer]['votes_loss'] = voteLoss;
  })
}

setInterval(function(){
  try{
      cacluteProducerVotesLoss()
  }catch(e){

  }
}, 100 * 1000);

function getVoterLogsInfo(voterlogs){
  var arr = [];
  var total = 0;
  var map = {};

  if(!voterlogs) return arr;
  voterlogs.forEach(function(voterlog){
      var element = voterlog['voter'];
      var cacheData = votersInfo[element];
      if(cacheData){
          var voterInfo = getVoterInfo(element, true);
          var value = voterInfo.voter_info.staked / 10000;

          voterlog.info = {
              voter_info: {
                  staked: voterInfo.voter_info.staked
              }
          }

          if(!map[element]){
              total += value;
          }

          arr.push(voterlog);
          map[element] = 1;
      }
  })

  return {
      total: total,
      data: arr
  };
}

app.get('/getProducer/:producer', function(req, res, next){
  console.log(req.params.producer);
  var producer = req.params.producer;
  var page = req.query.p || 1;
  var size = req.query.size || 50;

  if(allProducersMap[producer]){
      var data = allProducersMap[producer];
      var voterData = getVoters(votedProducers[data.owner]['voters']);
      var rows = pagination(page, size, voterData);

      var addLogsData = getVoterLogsInfo(votedProducers[data.owner]["addLogs"]);
      var removeLogsData = getVoterLogsInfo(votedProducers[data.owner]["removeLogs"]);

      res.json({
          producer: data,
          voters: rows,
          addLogs: addLogsData.data,
          bpinfo: producerInfoTable[producer],
          cancelVoters: votedProducers[data.owner]["cancelVoters"],
          removeLogs: removeLogsData.data,
          stakeLogs: votedProducers[data.owner]["stakeLogs"],
          total: {
              add: addLogsData.total,
              remove: removeLogsData.total,
              diff: addLogsData.total - removeLogsData.total
          }
      });
  }
});

app.get('/getProducer/:producer/voters', function(req, res, next){
    var producer = req.params.producer;
    if(allProducersMap[producer]){
        var data = allProducersMap[producer];
        var voterData = getVoters(votedProducers[data.owner]['voters']);
        
        res.json({
            data: voterData.map((d) => {
                return {
                    voter: d.account_name,
                    staked: d.voter_info ? d.voter_info.staked : 0,
                    is_proxy: d.voter_info ? d.voter_info.is_proxy : 0
                }
            })
        });
    }
});


app.get('/getStatus', function(req, res, next){
  eos.getTableRows({
      json: true, 
      code: "eosio", 
      scope: "eosio",
      table: "global", 
      table_key: "", 
      limit: 1
    },
  (error, result) => {
      var row = result.rows[0];
      var percent = (row.total_activated_stake / 1e4 /1000011818*100).toFixed(3);
      var proxyPercent = (totalProxyedVotes / 1e4 /1000011818*100).toFixed(3);;
      chainState = row;
      res.json({
          percent_stacked: percent,
          producers: Object.keys(votedProducers).length,
          voters: Object.keys(allVoters).length,
          proxy_voters: Object.keys(proxyVoters).length,
          proxy_votes: totalProxyedVotes,
          proxy_votes_percent: proxyPercent,
          chain_state: row
      });
  })
});


app.get('/getVoteLogs', function(req, res, next){
  res.json(voterLogs);
});

app.get('/getStakeLogs', function(req, res, next){
  res.json(stakedLogs);
});


app.get('/getVoterStakeState', function(req, res, next){
  var voter = req.query.voter;

  if(voter){
      res.json(voterStakeState[voter]);
  }else{
      res.json(globalStakeState);
  }
});


app.get('/search', searchApi);


app.get('/getVoteProxy', function(req, res, next){
  var page = req.query.p || 1;
  var size = req.query.size || 50;
  var type = req.query.type || 'all';

  var data = getVoters(proxyVoters, true);
  data = data.filter((item) => {
    var proxyName = item.account_name;
    if(proxyinfoTable[proxyName]){
        item.info = proxyinfoTable[proxyName];
    }
    if(type == 'reg'){
        return item.info;
    }

    return true;
  });

  var rows = pagination(page, size, data);

//   rows.forEach(function(data){
//       var proxyName = data.account_name;
//       if(proxyinfoTable[proxyName]){
//           data.info = proxyinfoTable[proxyName];
//       }
//   })

  res.json({
      rows: rows,
      total: Object.keys(proxyVoters).length
  });
});



app.get('/voterCompare', function(req, res, next){
  var producers = req.query.producers || "";
  producers = producers.split(",");
  var dataRow = [];

  producers.forEach(function(producer){
      var data = allProducersMap[producer];
      var voterData = getVoters(votedProducers[data.owner]['voters']);
      var newData = [];
      voterData.forEach(function(voter){
          newData.push({
              account_name: voter.account_name,
              staked: voter.voter_info.staked,
          })
      })

      dataRow.push({
          producer: data,
          voters: newData
      })
  })

  res.json(dataRow);
});





function getProxyTotalVotes(voter){
    var proxyStacked = 0;
    var voterIsProxy = proxyVoters[voter];
    if(voterIsProxy){
        var proxyAllVoters =  Object.keys(proxyVoters[voter]["voters"]);
        var allVotersProxy = [];

        proxyAllVoters.forEach(function(proxyVoter){
            var proxyVoterInfo = votersInfo[proxyVoter];
            if(!proxyVoterInfo){
                needUpdateVoterTable[proxyVoter] = 1;
                console.log("proxyVoter info miss", proxyVoter, Date.now())
                return;
            }

            // var stakedFromSate = voterStakeState[proxyVoter];
            var stakedFromSate = getVoterStakedFromLocalState(proxyVoter);
            var stakedEos = parseInt(proxyVoterInfo.voter_info.staked);
            if(stakedFromSate &&  stakedFromSate.staked > 0){
               //  var totalStaked = stakedFromSate.cpu + stakedFromSate.net;
                stakedEos = stakedFromSate.staked;
            }
            proxyStacked += stakedEos;
        })
    }
    return proxyStacked;
}




function pushProducerVoterLog(producer, type, log){
	var firstVoteLog = votedProducers[producer][type][0];
	if(firstVoteLog && firstVoteLog.timestamp){
		 var lastTime = moment.utc(firstVoteLog.timestamp).utcOffset(moment().utcOffset()).unix();
		 var daysTime = moment().subtract(2, "days").unix();
		 if(lastTime < daysTime){
			  votedProducers[producer][type].shift();
		 }
	}

	if(firstVoteLog && !firstVoteLog.timestamp){
		votedProducers[producer][type].shift();
	}
	votedProducers[producer][type].push(log);
}


var stream = require('stream');
var liner = new stream.Transform( { objectMode: true } )

liner._transform = function (chunk, encoding, done) {
var data = chunk.toString()
if (this._lastLineData) data = this._lastLineData + data

var lines = data.split('\n')
this._lastLineData = lines.splice(lines.length-1,1)[0]

lines.forEach(this.push.bind(this))
done()
}

liner._flush = function (done) {
   if (this._lastLineData) this.push(this._lastLineData)
   this._lastLineData = null
   done()
}


FILE_PATH = config.database.voter_log;
var source = fs.createReadStream(FILE_PATH)
source.pipe(liner)

liner.on('readable', function () {
  var line
  while (line = liner.read()) {
      try{
          newVoterBlock(line);
      }catch(e){
          console.log("newVoterBlock", "error", e)
      }
  }
})


liner.on('end', function(){
  console.log("load log from file done");
  initlizeLogWatcher();
})


Tail = require('tail').Tail;

function initlizeLogWatcher(){
  FILE_PATH = config.database.voter_log;
  var tail = new Tail(FILE_PATH);

  tail.on("line", function(data) {
      console.log("tail new", data);
      try{
          newVoterBlock(data, true);
      }catch(e){
          console.log("newVoterBlock", "error", e)
      }
  });

  tail.on("error", function(error) {
  console.log('ERROR: ', error);
  });

}

var voteBlockCount = 0;
var skipBlock = 8394145;

var voterProxy = {};

function newVoterBlock(data, isTail){

  voteBlockCount++;
 // console.log("newVoterBlock", voteBlockCount);

  if(voterLogs.length > 50){
      voterLogs.shift();
  }

  data = JSON.parse(data);
  voterLogs.push(data);


  if(typeof data.voter !== "string"){
      data.voter =  data.voter.account_name;
  }

  var voter = data.voter;
  var producers = data.producers;
  var timestamp = data.timestamp;
  var block_num = data.block_num;
  var proxy = data.proxy;

  allVoters[voter] = allVoters[voter] || {};
  allVoters[voter]['producers'] = allVoters[voter]['producers'] || {};
  allVoters[voter]['actions'] = allVoters[voter]['actions'] || [];

  var voterData = data.voterData;
  var voterStaked = 0;
  if(voterData && voterData.voter_info){
    voterStaked = voterData.voter_info.staked;
  }

  if(block_num > skipBlock){
      needUpdateVoterTable[data.voter] = 1;
  }

  if(!votersInfo[voter]){
      console.log("fetch voter info", voter, Date.now());
      needUpdateVoterTable[voter] = 1
  }else{
  }


    // order
  var lastProxy = voterProxy[voter];
  var newProxyChanged =  lastProxy && (!proxy || proxy != lastProxy || data.producers.length);

  console.log('proxyChange', newProxyChanged, voter, lastProxy, proxy);

  // proxy changes
  if(newProxyChanged){
    try{

        var firstVoteLog = proxyVoters[lastProxy]["removeLogs"][0];
        if(firstVoteLog && firstVoteLog.timestamp){
            var lastTime = moment.utc(firstVoteLog.timestamp).utcOffset(moment().utcOffset()).unix();
            var daysTime = moment().subtract(2, "days").unix();
            if(lastTime < daysTime){
                proxyVoters[lastProxy]["removeLogs"].shift();
            }
        }

        if(firstVoteLog && !firstVoteLog.timestamp){
            proxyVoters[lastProxy]["removeLogs"].shift();
        }

        proxyVoters[lastProxy]["removeLogs"].push({
            voter: voter,
            block_num: block_num,
            timestamp: timestamp,
            staked: voterStaked
        });

        if(isTail) {
            botter.notify({
                action: 'remove',
                proxy: proxy,
                voter: voter,
                block_num: block_num,
                timestamp: timestamp,
                staked: voterStaked
            });
        }
    }catch(e){
        console.log('proxyChange error', e);
    }
  
    
    delete proxyVoters[lastProxy]["voters"][voter];
    // delete
    if(!proxy) delete voterProxy[voter];
  }


  if(proxy && !data.producers.length){
      proxyVoters[proxy] = proxyVoters[proxy] || {};
      proxyVoters[proxy]["voters"] = proxyVoters[proxy]["voters"] || {};
      proxyVoters[proxy]["addLogs"] = proxyVoters[proxy]["addLogs"] || [];
      proxyVoters[proxy]["removeLogs"] = proxyVoters[proxy]["removeLogs"] || [];
      proxyVoters[proxy]["stakeLogs"] = proxyVoters[proxy]["stakeLogs"] || [];

      var isFirstSetProxy = !proxyVoters[proxy]["voters"][voter];

      var actionNameP = isFirstSetProxy ? 'add' : 'revote';
      var lastSetTime = !isFirstSetProxy ? proxyVoters[proxy]["voters"][voter] : null;
    //   if(isFirstSetProxy){

        var firstVoteLog = proxyVoters[proxy]["addLogs"][0];
          if(firstVoteLog && firstVoteLog.timestamp){
              var lastTime = moment.utc(firstVoteLog.timestamp).utcOffset(moment().utcOffset()).unix();
              var daysTime = moment().subtract(2, "days").unix();
              if(lastTime < daysTime){
                proxyVoters[proxy]["addLogs"].shift();
              }
          }

          if(firstVoteLog && !firstVoteLog.timestamp){
            proxyVoters[proxy]["addLogs"].shift();
          }

			
			 var voterLog = {
				voter: voter,
				block_num: block_num,
				staked: voterStaked,
				timestamp: timestamp,
				action: actionNameP,
				last_time: lastSetTime
			}

         var weight_change = 0;

			if(lastSetTime){
				weight_change = voteDecayDetal(voterStaked, lastSetTime, timestamp);
				voterLog.diff_weight_change = weight_change;
			}

			if(actionNameP == "revote" ){
				console.log('weight_change', weight_change);
				if(weight_change > 0){
					proxyVoters[proxy]["addLogs"].push(voterLog);
					if(isTail) {
						botter.notify({
							action: actionNameP,
							proxy: proxy,
							voter: voter,
							block_num: block_num,
							timestamp: timestamp,
							staked: voterStaked,
							diff_weight_change: weight_change,
							last_time: lastSetTime
						});
					}
				}
			}else{
				proxyVoters[proxy]["addLogs"].push(voterLog);
				if(isTail) {
					botter.notify({
						action: actionNameP,
						proxy: proxy,
						voter: voter,
						block_num: block_num,
						timestamp: timestamp,
						staked: voterStaked,
						diff_weight_change: weight_change,
						last_time: lastSetTime
					});
				}
			}
        
    //   }

      proxyVoters[proxy]["voters"][voter] = timestamp;
    //   proxyVoters[proxy]["voters"][voter]++;
	  voterProxy[voter] = proxy;
	  
	    

  }
  
  if(proxy){
    needUpdateVoterTable[proxy] = 1;
  }

  var voterIsProxy = proxyVoters[voter];
  if(voterIsProxy){
      console.log("voterIsProxy", "refresh voter info");
      Object.keys(proxyVoters[voter]["voters"]).forEach(function(proxyVoter){
          needUpdateVoterTable[proxyVoter] = 1;
      })
      var proixedVotes = getProxyTotalVotes(voter);
      if(proixedVotes){
        voterStaked = proixedVotes;
        console.log('rewrite proxy staked', voter, proixedVotes);
      }
  }

 


  var detalProducers = [];
  var lastAllProducers = Object.keys(allVoters[voter]['producers']);

  producers.forEach(function(producer){

      votedProducers[producer] = votedProducers[producer] || {};
      votedProducers[producer]["voters"] = votedProducers[producer]["voters"] || {};
      votedProducers[producer]["totalStaked"] = votedProducers[producer]["totalStaked"] || 0;
      votedProducers[producer]["blocks"] = votedProducers[producer]["blocks"] || [];

      votedProducers[producer]["addLogs"] = votedProducers[producer]["addLogs"] || [];
      votedProducers[producer]["removeLogs"] = votedProducers[producer]["removeLogs"] || [];
      votedProducers[producer]["cancelVoters"] = votedProducers[producer]["cancelVoters"] || [];
      votedProducers[producer]["stakeLogs"] = votedProducers[producer]["stakeLogs"] || [];

      var isNewVoter = !votedProducers[producer]["voters"][voter];

      var actionName = isNewVoter ? 'add' : 'revote';
      var lastVoteTime = !isNewVoter ? votedProducers[producer]["voters"][voter] : null;

      votedProducers[producer]["voters"][voter] = timestamp;
    //   votedProducers[producer]["voters"][voter]++;

      if(!votedProducers[producer]["voters"][voter]){
          votedProducers[producer]["totalStaked"] += voterStaked;
      }

      votedProducers[producer]["blocks"].push(data.block_num);

    

    //   if(isNewVoter){
          var firstVoteLog = votedProducers[producer]["addLogs"][0];
          if(firstVoteLog && firstVoteLog.timestamp){
              var lastTime = moment.utc(firstVoteLog.timestamp).utcOffset(moment().utcOffset()).unix();
              var daysTime = moment().subtract(2, "days").unix();
              if(lastTime < daysTime){
                  votedProducers[producer]["addLogs"].shift();
              }
          }

          if(firstVoteLog && !firstVoteLog.timestamp){
              votedProducers[producer]["addLogs"].shift();
          }
				 
			
			 var voterActionLog = {
				voter: voter,
				block_num: block_num,
				staked: voterStaked,
				timestamp: timestamp,
				action: actionName,
				last_time: lastVoteTime
			};
			 
			var vpweight_change = 0;

			if(lastVoteTime){
				vpweight_change = voteDecayDetal(voterStaked, lastVoteTime, timestamp);
				voterActionLog.diff_weight_change = vpweight_change;
			}

			if(actionName == "revote"){
				if(vpweight_change > 0){
					votedProducers[producer]["addLogs"].push(voterActionLog);
					if(isTail) {
						botter.notify({
							action: actionName,
							producer: producer,
							voter: voter,
							block_num: block_num,
							timestamp: timestamp,
							staked: voterStaked,
							diff_weight_change: vpweight_change,
							last_time: lastVoteTime
						});
				  	}
				}
			}else{
				votedProducers[producer]["addLogs"].push(voterActionLog);
        		if(isTail) {
					botter.notify({
						action: actionName,
						producer: producer,
						voter: voter,
						block_num: block_num,
						timestamp: timestamp,
						staked: voterStaked,
						diff_weight_change: vpweight_change,
						last_time: lastVoteTime
					});
			  }
			}

    //   }

      allVoters[voter]['producers'][producer] = allVoters[voter]['producers'][producer] || {};
      allVoters[voter]['producers'][producer]['blocks'] =  allVoters[voter]['producers'][producer]['blocks'] || [];
      allVoters[voter]['producers'][producer]['blocks'].push(data.block_num);

      if(lastAllProducers.indexOf(producer) > -1){

      }else{
          detalProducers.push(producer);
      }
  })

  allVoters[voter]['vote_time'] = timestamp;

  var voterAction = {};

  voterAction.timestamp = timestamp;
  voterAction.block_num =  block_num;

  var allProducers = Object.keys(allVoters[voter]['producers']);
  var canceledProducers = [];

  allProducers.forEach(function(producer){
      if(producers.indexOf(producer) > -1){

      }else{
          canceledProducers.push(producer);
      }
  })

  voterAction.canceled = canceledProducers;
  voterAction.detal = detalProducers;

  canceledProducers.forEach(function(votedProducer){
      if(votedProducers[votedProducer]){
          var voters = votedProducers[votedProducer]["voters"];
          if(voters[voter]){
              var cancelWeight = voterStaked /  votedProducers[votedProducer]["totalStaked"];
              if(cancelWeight > 0.05){
                  if(votedProducers[votedProducer]["cancelVoters"].length > 55){
                      votedProducers[votedProducer]["cancelVoters"].shift();
                  }
                  votedProducers[votedProducer]["cancelVoters"].push({
                      voter: voter,
                      action: "remove",
                      block_num: block_num,
                      staked: voterStaked,
                      timestamp: timestamp
                  });
              }

              votedProducers[votedProducer]["totalStaked"] -= voterStaked;

              var firstVoteLog = votedProducers[votedProducer]["removeLogs"][0];
              if(firstVoteLog && firstVoteLog.timestamp){
                  var lastTime = moment.utc(firstVoteLog.timestamp).utcOffset(moment().utcOffset()).unix();
                  var daysTime = moment().subtract(2, "days").unix();
                  if(lastTime < daysTime){
                      votedProducers[votedProducer]["removeLogs"].shift();
                  }
              }

              if(firstVoteLog && !firstVoteLog.timestamp){
                  votedProducers[votedProducer]["removeLogs"].shift();
              }

              votedProducers[votedProducer]["removeLogs"].push({
                  voter: voter,
                  block_num: block_num,
                  timestamp: timestamp,
                  staked: voterStaked
			  });
			  
			if(isTail) {
				botter.notify({
					action: 'remove',
					producer:votedProducer,
					voter: voter,
					block_num: block_num,
					timestamp: timestamp,
					staked: voterStaked
				});
			}

              delete voters[voter];
          }
      }

      if(allVoters[voter]['producers'][votedProducer]){
          delete allVoters[voter]['producers'][votedProducer];
      }
  })

  allVoters[voter]['actions'].push(voterAction);

  if(!producers.length){
      allVoters[voter]['producers'] = {};
      delete allVoters[voter];
  }
}



var voterStakeState = {};
var globalStakeState = {};

function newStakeBlock(data, isTail){
  data = JSON.parse(data);

  var receiver = data.receiver;
//   var receiver = data.from;
  var isVoter = allVoters[receiver];

  if(!isVoter){
      isVoter = voterProxy[receiver];
  }

  var stake_cpu, stake_net, unstake_cpu, unstake_net;

  if(data.stake_cpu_quantity){
      stake_cpu = parseFloat(data.stake_cpu_quantity);
      stake_net += parseFloat(data.stake_net_quantity);
  }

  if(data.unstake_net_quantity){
      unstake_cpu -= parseFloat(data.unstake_cpu_quantity);
      unstake_net -= parseFloat(data.unstake_net_quantity);
  }


  globalStakeState["total_staked"] = globalStakeState["total_staked"] || 0;

  if(data.stake_cpu_quantity){
      globalStakeState["total_staked"] += parseFloat(data.stake_cpu_quantity);
      globalStakeState["total_staked"] += parseFloat(data.stake_net_quantity);
  }

  if(data.unstake_net_quantity){
      globalStakeState["total_staked"] -= parseFloat(data.unstake_cpu_quantity);
      globalStakeState["total_staked"] -= parseFloat(data.unstake_net_quantity);
  }

  var unstake_cpu_quantity = 0, 
  			unstake_net_quantity = 0, 
		  stake_cpu_quantity = 0, 
		  stake_net_quantity = 0;


	if(data.stake_cpu_quantity){
		stake_cpu_quantity = parseFloat(data.stake_cpu_quantity);
		stake_net_quantity = parseFloat(data.stake_net_quantity);
	}

	if(data.unstake_net_quantity){
		unstake_cpu_quantity = parseFloat(data.unstake_cpu_quantity);
  		unstake_net_quantity = parseFloat(data.unstake_cpu_quantity);
	}
	

  var from = data.from;
  if(receiver != from){
		voterStakeState[from] =  voterStakeState[from] || { cpu: 0, net: 0, total: 0, to_others: { cpu: 0, net: 0, total: 0 } };

		if(data.stake_cpu_quantity){
			voterStakeState[from]['to_others']['cpu'] += stake_cpu_quantity;
			voterStakeState[from]['to_others']['net'] += stake_net_quantity;
			voterStakeState[from]['to_others']['total'] += stake_net_quantity;
			voterStakeState[from]['to_others']['total'] += stake_cpu_quantity;
		}

		if(data.unstake_net_quantity){
			action = "unstake";
			voterStakeState[from]['to_others']['cpu'] -= parseFloat(data.unstake_cpu_quantity);
			voterStakeState[from]['to_others']['net'] -= parseFloat(data.unstake_net_quantity);
			voterStakeState[from]['to_others']['total'] -= unstake_cpu_quantity;
			voterStakeState[from]['to_others']['total'] -= unstake_net_quantity;
		}
  }


  if(!isVoter){
      voterStakeState[receiver] =  voterStakeState[receiver] || { cpu: 0, net: 0, total: 0, to_others: { cpu: 0, net: 0, total: 0 }};
      var action = "stake";
      if(data.stake_cpu_quantity){
          voterStakeState[receiver]['cpu'] += parseFloat(data.stake_cpu_quantity);
			 voterStakeState[receiver]['net'] += parseFloat(data.stake_net_quantity);
			 voterStakeState[receiver]['total'] += parseFloat(data.stake_cpu_quantity);
			 voterStakeState[receiver]['total'] += parseFloat(data.stake_net_quantity);
      }

      if(data.unstake_net_quantity){
          action = "unstake";
          voterStakeState[receiver]['cpu'] -= parseFloat(data.unstake_cpu_quantity);
			 voterStakeState[receiver]['net'] -= parseFloat(data.unstake_net_quantity);
			 voterStakeState[receiver]['total'] -= parseFloat(data.unstake_cpu_quantity);
			 voterStakeState[receiver]['total'] -= parseFloat(data.unstake_net_quantity);
      }

      return;
  }else{

      if(stakedLogs.length > 50){
         stakedLogs.shift();
      }

      stakedLogs.push(data);

      voterStakeState[receiver] =  voterStakeState[receiver] || { cpu: 0, net: 0, total: 0, to_others: { cpu: 0, net: 0, total: 0 }};

      var action = "stake";
      if(data.stake_cpu_quantity){
          voterStakeState[receiver]['cpu'] += parseFloat(data.stake_cpu_quantity);
			 voterStakeState[receiver]['net'] += parseFloat(data.stake_net_quantity);
			 voterStakeState[receiver]['total'] += parseFloat(data.stake_cpu_quantity);
			 voterStakeState[receiver]['total'] += parseFloat(data.stake_net_quantity);
      }

      if(data.unstake_net_quantity){
          action = "unstake";
          voterStakeState[receiver]['cpu'] -= parseFloat(data.unstake_cpu_quantity);
			 voterStakeState[receiver]['net'] -= parseFloat(data.unstake_net_quantity);
			 voterStakeState[receiver]['total'] -= parseFloat(data.unstake_cpu_quantity);
			 voterStakeState[receiver]['total'] -= parseFloat(data.unstake_net_quantity);
      }

      voterStakeState[receiver]['is_proxy_voter'] = voterProxy[receiver];
      voterStakeState[receiver]['last_stake'] = data.timestamp;
      voterStakeState[receiver]['last_block'] = data.block_num;
      voterStakeState[receiver]['last_action'] = action;

      globalStakeState["proxy_staked"] = globalStakeState["proxy_staked"] || 0;
		globalStakeState["voter_staked"] = globalStakeState["voter_staked"] || 0;

		var voterStaked = 0;

      if(data.stake_cpu_quantity && voterProxy[receiver]){

			voterStaked += parseFloat(data.stake_cpu_quantity);
			voterStaked += parseFloat(data.stake_net_quantity);

          globalStakeState["proxy_staked"] += parseFloat(data.stake_cpu_quantity);
          globalStakeState["proxy_staked"] += parseFloat(data.stake_net_quantity);
      }

      if(data.unstake_net_quantity && voterProxy[receiver]){
			voterStaked += parseFloat(data.unstake_cpu_quantity);
			voterStaked += parseFloat(data.unstake_net_quantity);

          globalStakeState["proxy_staked"] -= parseFloat(data.unstake_cpu_quantity);
          globalStakeState["proxy_staked"] -= parseFloat(data.unstake_net_quantity);
      }

      if(data.stake_cpu_quantity && allVoters[receiver]){
          globalStakeState["voter_staked"] += parseFloat(data.stake_cpu_quantity);
          globalStakeState["voter_staked"] += parseFloat(data.stake_net_quantity);
      }

      if(data.unstake_net_quantity && allVoters[receiver]){
          globalStakeState["voter_staked"] -= parseFloat(data.unstake_cpu_quantity);
          globalStakeState["voter_staked"] -= parseFloat(data.unstake_net_quantity);
        }
        
        // track unstake logs

        var lastProxy = voterProxy[receiver];

        var stakeAmount = 0;

        if(data.unstake_cpu_quantity){
            stakeAmount = parseFloat(data.unstake_cpu_quantity) + parseFloat(data.unstake_net_quantity);
        }

        if(data.stake_cpu_quantity){
            stakeAmount = parseFloat(data.stake_cpu_quantity) + parseFloat(data.stake_net_quantity);
        }

        var unstakeLog = {
            action: action,
            voter: receiver,
            staked: stakeAmount,
            block_num: data.block_num,
            timestamp: data.timestamp
        }

        

        
        var needNotifyProducers = [];

        // proxy voter
        if(lastProxy){
            proxyVoters[lastProxy]["stakeLogs"] = proxyVoters[lastProxy]["stakeLogs"] || [];
            if(proxyVoters[lastProxy]["stakeLogs"].length > stakeLogsLimit){
                proxyVoters[lastProxy]["stakeLogs"].shift();
            }
            
            proxyVoters[lastProxy]["stakeLogs"].push(unstakeLog);
            
            // proxy voted producers
            if(allVoters[lastProxy]){
                var proxyVotedProducers = Object.keys(allVoters[lastProxy]['producers']);
                unstakeLog.proxy = lastProxy;
                if(proxyVotedProducers.length){
                    needNotifyProducers = needNotifyProducers.concat(proxyVotedProducers);
                }
            }

            if(isTail){
                botter.notify(Object.assign({}, unstakeLog,  {
                    type: 'stake',
                    proxy: lastProxy
                }));
            }
        }
        
        // votedProducer
        if(allVoters[receiver]){
            var lastAllProducers = Object.keys(allVoters[receiver]['producers']);
            if(lastAllProducers.length){
                needNotifyProducers = needNotifyProducers.concat(lastAllProducers);
            }
        }


        var notifyedProducers = {};
        
        console.log('stake log', unstakeLog, needNotifyProducers);

        needNotifyProducers.forEach(function(producer){
            if(notifyedProducers[producer]){
                return;
            }
            votedProducers[producer]["stakeLogs"] = votedProducers[producer]["stakeLogs"] || [];
            if(votedProducers[producer]["stakeLogs"].length > stakeLogsLimit){
                votedProducers[producer]["stakeLogs"].shift();
            }
            votedProducers[producer]["stakeLogs"].push(unstakeLog);
            if(isTail){
                botter.notify(Object.assign({}, unstakeLog,  {
                    type: 'stake',
                    producer: producer
                }));
            }

            notifyedProducers[producer] = 1;
            console.log('stake log', producer, unstakeLog);
        })


        // proxyVoters[proxy]["stakeLogs"]
		if(allVoters[receiver]){
			var lastAllProducers = Object.keys(allVoters[receiver]['producers']);
			var logTypes = {
				stake: 'removeLogs',
				unstake: 'addLogs'
			}

			var logType = logTypes[action];
			var log = {
				voter: receiver,
				block_num: data.block_num,
				staked: voterStaked,
				timestamp: data.timestamp
			};

			lastAllProducers.forEach(function(producer){
				if(0) pushProducerVoterLog(producer, logType, log);
			})
		}

  }
}



function initStakeWatcher(){
  var FILE_PATH = config.database.all_delegatebw;
  var source = fs.createReadStream(FILE_PATH)
  var liner = new stream.Transform( { objectMode: true } )
  liner._transform = function (chunk, encoding, done) {
  var data = chunk.toString()
  if (this._lastLineData) data = this._lastLineData + data

  var lines = data.split('\n')
  this._lastLineData = lines.splice(lines.length-1,1)[0]

  lines.forEach(this.push.bind(this))
  done()
  }

  liner._flush = function (done) {
      if (this._lastLineData) this.push(this._lastLineData)
      this._lastLineData = null
      done()
  }

  source.pipe(liner)

  liner.on('readable', function () {
      var line
      while (line = liner.read()) {
          try{
              newStakeBlock(line);
          }catch(e){
              console.log("newStakeBlock", "error", e)
          }
      }
  })

  var Tail = require('tail').Tail;
  var tail = new Tail(FILE_PATH);

  tail.on("line", function(data) {
      console.log("tail new", FILE_PATH, data);
      try{
          newStakeBlock(data, true);
      }catch(e){
          console.log("newStakeBlock", "error", e)
      }
  });

  tail.on("error", function(error) {
      console.log('ERROR: ', error);
  });
}


setTimeout(function(){
  initStakeWatcher();
}, 30 * 1000)

app.use(compression());
server.listen(8080);