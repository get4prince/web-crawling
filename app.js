const express = require('express')
const app = express()
const port = 3000;

const statusMonitor = require('express-status-monitor')();

app.use(statusMonitor);

app.get('/status', statusMonitor.pageRoute)

app.get('/', (req, res) => {
    res.send('Hello World!')
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})