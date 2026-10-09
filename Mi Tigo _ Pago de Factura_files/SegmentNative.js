cordova.define("cordova-plugin-segment-native.SegmentNative", function(require, exports, module) { var exec = require('cordova/exec');
exports.coolMethod = function (arg0, success, error) {
    exec(success, error, 'SegmentNative', 'coolMethod', [arg0]);
};
exports.track = function (arg0, success, error) {
    exec(success, error, 'SegmentNative', 'track', [arg0]);
};
exports.page = function (arg0, success, error) {
    exec(success, error, 'SegmentNative', 'page', [arg0]);
};
exports.reset = function (arg0, success, error) {
    exec(success, error, 'SegmentNative', 'reset', [arg0]);
};
exports.ready = function (arg0, success, error) {
    exec(success, error, 'SegmentNative', 'ready', [arg0]);
};
exports.anonymousId = function (arg0, success, error) {
    exec(success, error, 'SegmentNative', 'anonymousId', [arg0]);
};
exports.identify = function (arg0, success, error) {
    exec(success, error, 'SegmentNative', 'identify', [arg0]);
};
exports.camera = function (arg0, success, error) {
    exec(success, error, 'SegmentNative', 'camera', [arg0]);
};
exports.gallery = function (arg0, success, error) {
    exec(success, error, 'SegmentNative', 'gallery', [arg0]);
};
});
