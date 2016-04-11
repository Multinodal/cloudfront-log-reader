/*
*      nodejs script using cloudfront-log-reader library via mapbox.
*
*      take two jsonDates (startDate and endDate), scan s3 bucket for matching dates
*      (determined by log filename). Retrieve all matching files, unzip them, scan through
*      the file contents, and "replay" requests that fall within startDate and endDate
*/

var reader = require('./index.js');
var s3scan = require('s3scan');
var keepalive = require('agentkeepalive');
var split = require('split');

var agent = new keepalive.HttpsAgent({
    keepAlive: true,
    maxSockets: Math.ceil(require('os').cpus().length * 16),
    keepAliveTimeout: 60000
});

var startDate, endDate;

if( process.argv.length < 4 ) {
    console.log('\n\tSyntax: node.exe script-name.js [jsonDate Start] [jsonDate End]\n');
    JSONDateHelp();
    process.exit(1);
}
else {
    process.argv.forEach(function(v, i, arr) {
        switch (i) {
            case 2: startDate = new Date(v); break;
            case 3: endDate = new Date(v); break;
            default: break;
        }
    });
}

if( startDate.toJSON() == null || endDate.toJSON() == null ) {
    console.log("\n\tNull date detected, is your jsonDate formatting correct?\n");
    JSONDateHelp();
    process.exit(2);
}
else if( startDate > endDate ) {
    console.log('\n\tYour start date is later than your end date. Please adjust.\n');
    process.exit(3);
}

console.log("Start Date: %s", startDate.toJSON());
console.log("End Date..: %s", endDate.toJSON());

function listFiles(uri, callback) {
    found = [];
    s3scan.List(uri, {agent: agent})
        .on('error', function errorFunction(err) {
            console.log('Error retrieving S3 bucket list: %s', JSON.stringify(err));
        })
        .on('data', function dataFunction(keys) {
            keys = keys.toString().trim();
            keys.split('\n').forEach(function (key) {
                found.push(key);
            });
        })
        .on('end', function endFunction() {
            callback(found);
        });
}

/*
*  CloudFront Log File Name Format
*
*  The name of each log file that CloudFront saves in your Amazon S3 bucket uses the following file name format:
*  distribution-ID.YYYY-MM-DD-HH.unique-ID.gz
*/

function cloudFrontFileDate(filename) {
    var d = null,
        parts = filename.split('.');

    if( parts.length < 4 ) {
        throw ("cloudFrontFileDate function expects a filename seperated by a 4 dots.\nGot: " + filename);
    }
    else {
        dparts = parts[1].split('-');

        if( dparts.length < 4 ) {
            throw ("cloudFrontFileDate function expects part[1] to be YYYY-MM-DD-HH.\nGot: " + parts[1]);
        }
        else {
            // create a jsonDate string
            var jsonDate = dparts[0] + '-' + dparts[1] + '-' + dparts[2] + "T" + dparts[3] + ":00:00.000Z";
            d = new Date(jsonDate);
            return d;
        }
    }
}

function filterFileListByDate(found) {
    var s = new Date(startDate.toJSON()),
        e = new Date(endDate.toJSON()),
        files = [];

    // manipulate startDate and endDate to cover entire hour, as the filename only contains hour

    s.setUTCMinutes(0, 0, 0);
    e.setUTCMinutes(59, 59, 999);

    found.forEach(function(key) {
        var d = null;
        try {
            d = cloudFrontFileDate(key);
            var b =  (d >= s && d <= e);
            console.log('File %s (%s)', key, (b ? "in range" : "skip this file"));
            if( b ) files.push(key);
        }
        catch(err) {
            console.trace(err);
        }
    });

    processResults(files);
}

// Each CloudFront log line contains 23 tab-separated parts
// See: http://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html

function processResults(keys) {

    keys.forEach(function(key) {
        console.log("Processing: %s", key);

        reader.LogStream('s3://tdtile-logsamples/' + key)
            .pipe(split())
            .on('data123', function(d) {
                console.log('data length = %d.', d.length);
            })
            .on('data', function(data) {
                var parts = data.split('\t');
                delete data;
                if( parts.length > 20 ) {
                    console.log("%s %s %d", parts[0], parts[1], parts.length);
                }
                delete parts;
            });

    });
}

listFiles('s3://tdtile-logsamples/log-samples', filterFileListByDate);

function JSONDateHelp() {
    console.log('\t-----');
    console.log("\tjsonDate format example : 2016-03-01T08:15:00.123Z\n");
    console.log("\tReference: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toJSON\n");
}