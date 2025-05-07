var customHandler = null;

module.exports = {
    log(...args) {
        const date = new Date();
        const formattedDate = date.toISOString().replace(/T/, ' ').replace(/\..+/, '');

        const message = args.length > 1 ? args.join(' ') : args[0];

        if (customHandler) {
            customHandler(message);
            return;
        }

        console.log(`[${formattedDate}] ${message}`);
    },
    setCustomHandler(cb) {
        customHandler = cb;
    },
};
