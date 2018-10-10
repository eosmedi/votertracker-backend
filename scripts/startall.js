const fork = require('child_process').fork;

const processList = [
    'monitor.js',
    'proxy.js',
    'recoder.js',
];


processList.forEach((process) => {
    var childProcess = fork(__dirname+'/'+process);
    childProcess.on('exit', (error) => {
        console.log(error);
    })
    // console.log(childProcess);
});