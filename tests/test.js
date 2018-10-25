
var fs = require('fs');

var voterStakeState = {};
var globalStakeState = {};
var allVoters = {};
var voterProxy ={};

function newStakeBlock(data, isTail){
  data = JSON.parse(data);

  var receiver = data.receiver;
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

  if(!isVoter){
      voterStakeState[receiver] =  voterStakeState[receiver] || { cpu: 0, net: 0 };
      var action = "stake";
      if(data.stake_cpu_quantity){
          voterStakeState[receiver]['cpu'] += parseFloat(data.stake_cpu_quantity);
          voterStakeState[receiver]['net'] += parseFloat(data.stake_net_quantity);
      }

      if(data.unstake_net_quantity){
          action = "unstake";
          voterStakeState[receiver]['cpu'] -= parseFloat(data.unstake_cpu_quantity);
          voterStakeState[receiver]['net'] -= parseFloat(data.unstake_net_quantity);
      }

      return;
  }else{

      if(stakedLogs.length > 50){
         stakedLogs.shift();
      }

      stakedLogs.push(data);

      voterStakeState[receiver] =  voterStakeState[receiver] || { cpu: 0, net: 0 };

      var action = "stake";
      if(data.stake_cpu_quantity){
          voterStakeState[receiver]['cpu'] += parseFloat(data.stake_cpu_quantity);
          voterStakeState[receiver]['net'] += parseFloat(data.stake_net_quantity);
      }

      if(data.unstake_net_quantity){
          action = "unstake";
          voterStakeState[receiver]['cpu'] -= parseFloat(data.unstake_cpu_quantity);
          voterStakeState[receiver]['net'] -= parseFloat(data.unstake_net_quantity);
      }
    }
}


var files = fs.readFileSync('./stake.logs', 'utf-8').split("\n");


files.forEach((line) => {
    newStakeBlock(line);
})


console.log(voterStakeState)