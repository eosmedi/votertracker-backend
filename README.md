# votetracker backend
stream vote logs by websocket 

``` js
var socket = io('https://api.votetracker.io');
socket.on('log', (log) => {
    console.log('log', log);
})
```