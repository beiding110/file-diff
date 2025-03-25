function uint8arrayToBase64(u8Arr) {
    let CHUNK_SIZE = 0x8000; //arbitrary number
    let index = 0;
    let length = u8Arr.length;
    let result = '';
    let slice;
    while (index < length) {
        slice = u8Arr.subarray(index, Math.min(index + CHUNK_SIZE, length));
        result += String.fromCharCode.apply(null, slice);
        index += CHUNK_SIZE;
    }

    // web image base64图片格式: "data:image/png;base64," + b64encoded;
    // return  "data:image/png;base64," + btoa(result);
    return btoa(result);
}

function base64ToUint8Array(base64String) {
    let padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    let base64 = (base64String + padding).replace(/\\-/g, '+').replace(/_/g, '/');

    let rawData = window.atob(base64);
    let outputArray = new Uint8Array(rawData.length);

    for (var i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

module.exports = {
    uint8arrayToBase64,
    base64ToUint8Array,
};
