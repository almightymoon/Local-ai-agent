const {openIde} = require('./ide-runtime.cjs');
openIde(process.argv[2]).catch(error => {console.error(error.message); process.exitCode = 1;});
