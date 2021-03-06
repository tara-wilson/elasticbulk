const _ = require("lodash");
const Promise = require("bluebird");
const isStream = require("is-stream");
const { Client } = require("@elastic/elasticsearch");

/**
 * data is json array of objects or stream
 */
module.exports.import = function (data, options, schema) {
  options = options || {};
  options.concurrency = options.concurrency || 1;

  if (!options.host) {
    return Promise.reject("Please define host name");
  }

  if (!options.index) {
    return Promise.reject("Please provide index name");
  }

  if (isStream(data)) {
    data.pause();
  }

  return Promise.resolve().then(function (res) {
    if (isStream(data)) {
      return module.exports.addItemsStream(data, options);
    } else {
      return Promise.all(_.chunk(data, 500)).map(
        (v) => {
          return module.exports.addBulkItems(v, options);
        },
        {
          concurrency: options.concurrency,
        }
      );
    }
  });
};

/**
 * import data by stream (file, json, psql, etc)
 */
module.exports.addItemsStream = function (stream, options) {
  return new Promise(function (resolve, reject) {
    var counter = 0;
    var items = [];
    var counter_limit = options.chunk_size || options.limit || 100;
    var added = 1;

    stream.on("data", function (item) {
      ++counter;
      items.push(item);

      if (counter >= counter_limit) {
        stream.pause();

        return module.exports.addBulkItems(items, options).then(function (res) {
          counter = 0;
          items = [];
          console.log(added + " series added!");
          added++;
          stream.resume();
        });
      }
    });

    stream.on("end", function (data) {
      if (!items.length) {
        return resolve();
      }

      module.exports.addBulkItems(items, options).then(function (res) {
        console.log("Last " + added + " series added!");
        return resolve();
      });
    });

    stream.on("close", function (data) {
      return resolve();
    });

    stream.on("error", function (err) {
      console.log("error", err);
      return reject(err);
    });

    /**
     * it waits until creating schema is not finished
     */
    stream.resume();
  });
};

module.exports.addBulkItems = function (items, options, schema) {
  var body = [];
  for (var i = 0; i < items.length; ++i) {
    var o = { index: { _id: items[i] ? items[i].external_id : undefined } };
    body.push(o);
    body.push(items[i]);
  }

  const elastic = new Client({
    node: options.host,
    auth: {
      username: "elastic",
      password: options.pass,
    },
    defer: function () {
      return Promise.defer();
    },
  });

  return elastic
    .bulk({
      index: options.index,
      body: body,
    })
    .then((v) => {
      if (options.debug && v.errors) {
        console.log(JSON.stringify(v, null, 2));
      }
    });
};
