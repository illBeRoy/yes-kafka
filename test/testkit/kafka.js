'use strict';

var Docker = require('dockerode');
var Promise = require('bluebird');
var dockerUtils = require('./dockerode-utils');

var docker = new Docker();
var container = {};
var dockerKafkaPort = 9092;
var dockerKafkaSslPort = 9093;
var dockerZookeeperPort = 2181;

function createTopic(topicName) {
    var kafkaCommand = [
        '$KAFKA_HOME/bin/kafka-topics.sh',
        '--zookeeper', '127.0.0.1:2181',
        '--create', '--topic', topicName,
        '--partitions', '3',
        '--replication-factor', '1',
    ];
    var command = [
        'bash', '-c', kafkaCommand.join(' '),
    ];
    return dockerUtils.containerExec(container, command);
}

function createTopics(topicNames) {
    return Promise.map(topicNames, function (topicName) {
        return createTopic(topicName);
    });
}

before(function () {
    this.timeout(120000);
    return dockerUtils.imageExists(docker, 'spotify/kafka')
    .then(function (exists) {
        if (!exists) {
            return dockerUtils.pullImageAsync(docker, 'spotify/kafka');
        }
        return Promise.resolve();
    })
    .then(function () {
        return docker.buildImage({
            context: __dirname,
            src: [
                'Dockerfile',
                'ssl/server.keystore.jks',
                'ssl/server.truststore.jks',
            ],
        }, { t: 'no-kafka' });
    })
    .then(function (stream) {
        return new Promise(function (resolve, reject) {
            docker.modem.followProgress(stream, function (err, res) {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            });
        });
    })
    .then(function () {
        return docker.createContainer({
            Image: 'no-kafka',
            HostConfig: {
                PortBindings: {
                    ['2181/tcp']: [{ HostPort: `${dockerZookeeperPort}/tcp` }],
                    ['9092/tcp']: [{ HostPort: `${dockerKafkaPort}/tcp` }],
                    ['9093/tcp']: [{ HostPort: `${dockerKafkaSslPort}/tcp` }],
                },
            }
        });
    }).then(function (_container) {
        container = _container;
        return container.start();
    })
    .then(function () {
        console.log('Waiting for kafka to start...'); // eslint-disable-line
        return dockerUtils.waitForOutput(container, function (line) {
            return line.search('kafka entered RUNNING state') > 0;
        });
    })
    .then(function () {
        console.log('Kafka started'); // eslint-disable-line
    });
});

after(function () {
    return docker.listContainers().then(function (containers) {
        return containers.filter(function (_container) { return _container.Image === 'no-kafka'; });
    }).then(function (containers) {
        return Promise.map(containers, function (_container) {
            return docker.getContainer(_container.Id).stop();
        });
    });
});

module.exports = {
    createTopic,
    createTopics,
};
