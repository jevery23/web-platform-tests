function runTest(config,qualifier) {

    var testname = testnamePrefix(qualifier, config.keysystem)
                                    + ', persistent-license, '
                                    + /video\/([^;]*)/.exec(config.videoType)[1]
                                    + ', playback, check events';

    var configuration = {   initDataTypes: [ config.initDataType ],
                            audioCapabilities: [ { contentType: config.audioType } ],
                            videoCapabilities: [ { contentType: config.videoType } ],
                            sessionTypes: [ 'persistent-license' ] };


    async_test(function(test) {
        var _video = config.video,
            _mediaKeys,
            _mediaKeySession,
            _mediaSource,
            _receivedTimeupdateEvent = false,
            _startedReleaseSequence = false,
            _events = [ ];

        function recordEventFunc( eventType ) {
            return function() { _events.push( eventType ); };
        }

        function onFailure(error) {
            forceTestFailureFromPromise(test, error);
        }

        function onMessage(event) {
            assert_equals( event.target, _mediaKeySession );
            assert_true( event instanceof window.MediaKeyMessageEvent );
            assert_equals( event.type, 'message');

            if (!_startedReleaseSequence) {
                assert_in_array(event.messageType, ['license-request', 'individualization-request']);
            } else {
                assert_equals(event.messageType, 'license-release');
            }

            if (event.messageType !== 'individualization-request') {
                _events.push(event.messageType);
            }

            config.messagehandler(event.messageType, event.message ).then(function(response) {
                _events.push(event.messageType + '-response');
                return _mediaKeySession.update(response);
            }).then(test.step_func(function() {
                _events.push('updated');
                if (event.messageType === 'license-release') {
                    var events1 = ['generaterequest'];
                    var events2 = ['license-request', 'license-request-response', 'updated'];
                    var events3 = [ 'keystatuseschange',
                                    'playing',
                                    'remove',
                                    'keystatuseschange',
                                    'license-release',
                                    'license-release-response',
                                    'closed-promise',
                                    'updated' ];
                    assert_array_equals(_events.slice(0,events1.length), events1, "Expected initial events");
                    var i = events1.length;
                    for(; i < _events.length-events3.length; i+=events2.length) {
                        assert_array_equals(_events.slice(i,i+events2.length), events2, "Expected one or more license request sequences");
                    }
                    assert_greater_than(i,events1.length, "Expected at least one license request sequence");
                    assert_array_equals(_events.slice(i), events3, "Expected events sequence" );
                    test.done();
                }
            })).catch(onFailure);
        }

        function onKeyStatusesChange(event) {
            assert_equals(event.target, _mediaKeySession);
            assert_true(event instanceof window.Event);
            assert_equals(event.type, 'keystatuseschange');
            _events.push('keystatuseschange');
        }

        function onEncrypted(event) {
            assert_equals(event.target, _video);
            assert_true(event instanceof window.MediaEncryptedEvent);
            assert_equals(event.type, 'encrypted');

            _mediaKeySession.generateRequest(   config.initData ? config.initDataType : event.initDataType,
                                                config.initData || event.initData ).then(recordEventFunc('generaterequest')
            ).catch(onFailure);
        }

        function onTimeupdate(event) {
            if ( _video.currentTime > ( config.duration || 1 ) && !_receivedTimeupdateEvent ) {
                _receivedTimeupdateEvent = true;
                _video.pause();
                _video.removeAttribute('src');
                _video.load();

                _startedReleaseSequence = true;
                _mediaKeySession.remove().then(recordEventFunc('remove')).catch(onFailure);
            }
        }

        function onPlaying(event) {
            _events.push( 'playing' );
        }

        navigator.requestMediaKeySystemAccess(config.keysystem, [ configuration ]).then(function(access) {
            return access.createMediaKeys();
        }).then(function(mediaKeys) {
            _mediaKeys = mediaKeys;
            return _video.setMediaKeys(_mediaKeys);
        }).then(function() {
            waitForEventAndRunStep('encrypted', _video, onEncrypted, test);
            waitForEventAndRunStep('playing', _video, onPlaying, test);
            // Not using waitForEventAndRunStep() to avoid too many
            // EVENT(onTimeUpdate) logs.
            _video.addEventListener('timeupdate', onTimeupdate, true);
            _mediaKeySession = _mediaKeys.createSession( 'persistent-license' );
            waitForEventAndRunStep('keystatuseschange', _mediaKeySession, onKeyStatusesChange, test);
            waitForEventAndRunStep('message', _mediaKeySession, onMessage, test);
            _mediaKeySession.closed.then( recordEventFunc( 'closed-promise' ) );
            return testmediasource(config);
        }).then(function(source) {
            _mediaSource = source;
            _video.src = URL.createObjectURL(_mediaSource);
            return source.done;
        }).then(function(){
            _video.play();
        }).catch(onFailure);
    }, testname);
}