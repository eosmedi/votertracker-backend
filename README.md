# votetracker backend
stream vote logs by socket.io 

``` js
var socket = io('https://api.votetracker.io');
socket.on('log', (log) => {
    console.log('log', log);
})
```