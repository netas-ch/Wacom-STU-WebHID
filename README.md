# Wacom-STU-WebHID
JavaScript library to use the Wacom STU series (540) Signature pad tablets with WebHID API on the browser, without external apps or drivers.

Library to connect the browser to a WACOM STU-540/k signature pad.

### class
    /**
     * add a event listener
     * @param {String} eventName (hidConnect, hidDisconnect, penData)
     * @param {Function} callbackFn
     * @param {Object|null} context
     * @returns {undefined}
     */
    on(eventName, callbackFn, context)

    /**
     * Check is a usb hid from wacom vid+pid is present
     * Note: WebHID needs a positive hid.requestDevice to be allowed to show here and on hid events. do use this for the first connect.
     * @returns {Boolean} found a compatible device
     */
    async isAvailable()


    /**
     * Check if theres a device connected
     * @returns {Boolean} connection status
     */
    isConnected()

    /**
     * Connect to the device
     * @returns {Boolean} success or failure
     */
    async connect()

    /**
     * Retrives general data from the device
     * @returns {Object} info of the device
     */
    getTabletInfo()

    /**
     * returns the svg element to display live signature data on the screen
     * @returns SVGElement
     */
    getSvgElement()

    /**
     * get the svg image of the signature.
     * @returns {String} string containing an object URL that can be used to reference the contents of the specified source
     */
    getSvg()

    /**
     * Set pen color
     * @param {String} color color in '#RRGGBB' format
     * @param {Number} width pen thickness, can be 0-3
     */
    async setPenColorAndWidth(color, width)

    /**
     * Set backlight intensity, can be 0-3.
     * Note: it seems its not good to call this frequently.
     * See: http://developer-docs.wacom.com/faqs/docs/q-stu/stu-sdk-application#how-can-i-switch-the-stu-off-when-not-in-use
     * @param {Number} intensity 0-3
     */
    async setBrightness(intensity)

    /**
     * Set background color, must clear screen to take effect
     * Note: it seems its not good to call this frequently
     * @param {String} color color in '#RRGGBB' format
     */
    async setBackgroundColor(color)

    /**
     * Set writing area of the tablet.
     * @param {Object} p format {x1:0,y1:0,x2:800,y2:480} where x1,y1=left top and x2,y2=right bottom
     */
    async setWritingArea(p)

    /**
     * Set writing mode
     * @param {Number} mode 0: stroke with width from setting, 1: stroke with width from pressure
     */
    async setWritingMode(mode)

    /**
     * Enable or disable inking the screen. This does not stop events.
     * @param {Boolean} enabled Status of inking
     */
    async setInking(enabled)

    /**
     * Clear screen to background color
     */
    async clearScreen()

    /**
     * send a canvas to the pad. the canvas should have the dimension of the pad.
     * @param {CanvasRenderingContext2D} ctx Canvas 2D
     * @param {Number} offsetX offset to read the image data
     * @param {Number} offsetY offset to read the image data
     * @param {Boolean} drawToSvg draw image do svg
     * @returns {Promise}
     */
    async setCanvas(ctx, offsetX=0, offsetY=0, drawToSvg=true)

    /**
     * Send a raw image to the pad.
     * @param {Array} imageData Image must be BGR 24bpp 800x480.
     */
    async setImage(imageData)

