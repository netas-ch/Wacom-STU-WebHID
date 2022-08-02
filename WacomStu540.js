/*
    WACOM STU-540 WebHID Driver
    ___________________________________________________

    © 2022 Pablo García <pablomorpheo@gmail.com> - MIT License
    https://github.com/pabloko/Wacom-STU-WebHID
    ___________________________________________________

    Modiefied by netas.ch, Lukas Buchs
    https://github.com/netas-ch/Wacom-STU-WebHID
    ___________________________________________________
*/


class WacomStu540 {
    #config;
    #command;
    #device; // Store internal hidDevice
    #signaturePath; // stored path
    #svgElement;
    #svgPolyLine;
    #events;
    #deviceIsSending;

    constructor() {

        // Check if WebHID is supported
        if (!navigator || !('hid' in navigator)) {
            throw new Error('WebHID not supported');
        }

        /**
         * Device configuration, information and capabilities
         */
        this.#config = {
            chunkSize           : 253,
            vid                 : 0x56A,
            pid                 : 0xA8,
            imageFormat24BGR    : 0x04,
            width               : null,
            height              : null,
            scaleFactorX        : null,
            scaleFactorY        : null,
            tabletMaxPressure   : null,
            maxReportRate       : null,
            tabletMaxX          : null,
            tabletMaxY          : null,

            penColor            : null, // [r, g, b]
            penWidth            : null,
            backgroundColor     : null, // [r, g, b]
            brightness          : null,

            inkMode             : null,
            writingMode         : null,
            writingArea         : null, // [x1, x2

            deviceName          : null,
            firmware            : null,
            eSerial             : null
        };

        /**
         * Report ids (See SDK for more info and compatibility matrix, direction, etc...)
         */
        this.#command = {
            penData         : 0x01,
            information     : 0x08,
            capability      : 0x09,
            writingMode     : 0x0E,
            eSerial         : 0x0F,
            clearScreen     : 0x20,
            inkMode         : 0x21,
            writeImageStart : 0x25,
            writeImageData  : 0x26,
            writeImageEnd   : 0x27,
            writingArea     : 0x2A,
            brightness      : 0x2B,
            backgroundColor : 0x2E,
            penColorAndWidth: 0x2D,
            penDataTiming   : 0x34
        };

        // Store internal hidDevice
        this.#device = null;

        // event handlers to invoke
        this.#events = [];

        // stored path of the signature
        this.#signaturePath = [];

        // prohibit double sending
        this.#deviceIsSending = false;

        // svg element
        this.#svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.#svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        // current svg polyline
        this.#svgPolyLine = null;

        // HID events
        navigator.hid.addEventListener("connect", (e) => {
            if (e.device.vendorId === this.#config.vid && e.device.productId === this.#config.pid) {
                this.#raiseEvent('hidConnect', [e.device]);
            }
        });

        navigator.hid.addEventListener("disconnect", (e) => {
            if (e.device.vendorId === this.#config.vid && e.device.productId === this.#config.pid) {
                this.#raiseEvent('hidDisconnect', [e.device]);
            }
        });
    }


    // -------------------------------------------------
    // public methods
    // -------------------------------------------------

    /**
     * add a event listener
     * penData-Event:
     * -------------------------------------------------------------------------
     *      rdy:     Returns TRUE if the pen is in proximity with the tablet
     *      sw:      Returns TRUE if the pen is in contact with the surface
     *      press:   Returns pen pressure in tablet units (0-1024)
     *      cpress:  Returns pen pressure 0 ... 1
     *      cx:      x in screen pixel
     *      cy:      y in screen pixel
     *      x:       Point x in tablet scale
     *      y:       Point y in tablet scale
     *      time:    timestamp
     *      seq:     incremental number
     *
     *
     * @param {String} eventName (hidConnect, hidDisconnect, penData)
     * @param {Function} callbackFn
     * @param {Object|null} context
     * @returns {undefined}
     */
    on(eventName, callbackFn, context) {
        this.#events.push({eventName: eventName, callbackFn: callbackFn, context: context});
    }


    /**
     * Remove a event from the stack. pass null to remove all.
     * @param {String|null} eventName
     * @param {Function|null} callbackFn
     * @param {Object|null} context
     * @returns {undefined}
     */
    un(eventName=null, callbackFn=null, context=null) {
        this.#events = this.#events.filter((e) => {
            return ((eventName === e.eventName || eventName === null)
                    && (callbackFn === e.callbackFn || callbackFn === null)
                    && (context === e.context || context === null)) ? false : true;
        });
    }

    /**
     * Check is a usb hid from wacom vid+pid is present
     * Note: WebHID needs a positive hid.requestDevice to be allowed to show here and on hid events. Do not use this for the first connection.
     * @returns {Boolean} found a compatible device
     */
    async isAvailable() {
        if (this.isConnected()) {
            return true;
        }

        let devices = await navigator.hid.getDevices();
        for (let i = 0; i < devices.length; i++) {
            let device = devices[i];
            if (device.vendorId === this.#config.vid && device.productId === this.#config.pid) {
                return true;
            }
        }

        return false;
    }


    /**
     * Check if theres a device connected
     * @returns {Boolean} connection status
     */
    isConnected() {
        return this.#device !== null && this.#device.opened;
    }

    /**
     * Connect to the device
     * @returns {Boolean} success or failure
     */
    async connect() {

        // already connected?
        if (this.isConnected()) {
            return true;
        }

        this.#device = null;

        // check if we had already a connection, then we can reopen without prompting
        let devices = await navigator.hid.getDevices();
        for (let i = 0; i < devices.length; i++) {
            let device = devices[i];
            if (device.vendorId === this.#config.vid && device.productId === this.#config.pid) {
                this.#device = device;
            }
        }

        // connect to new hid device
        if (!this.#device) {
            let dev = await navigator.hid.requestDevice({ filters: [{vendorId: this.#config.vid, productId: this.#config.pid}] });
            if (dev.length < 1 || dev[0] === null) {
                return false;
            }
            this.#device = dev[0];
        }

        // Open the device
        if (!this.#device.opened) {
            await this.#device.open();
        }

        // Set handler to read input reports (this contains pen data)
        this.#device.addEventListener("inputreport", this.#onHidInputReport.bind(this));

        // Read info and capabilities from device and fill the data
        let dv = await this.#readData(this.#command.capability);
        this.#config.tabletMaxX = dv.getUint16(1);
        this.#config.tabletMaxY = dv.getUint16(3);
        this.#config.tabletMaxPressure = dv.getUint16(5);
        this.#config.width = dv.getUint16(7);
        this.#config.height = dv.getUint16(9);
        this.#config.maxReportRate = dv.getUint8(11);
        this.#config.scaleFactorX = this.#config.tabletMaxX / this.#config.width;
        this.#config.scaleFactorY = this.#config.tabletMaxY / this.#config.height;

        // information
        dv = await this.#readData(this.#command.information);
        this.#config.deviceName = this.#dataViewString(dv, 1, 7);
        this.#config.firmware = dv.getUint8(8) + "." + dv.getUint8(9) + "." + dv.getUint8(10) + "." + dv.getUint8(11);

        // eSerial
        dv = await this.#readData(this.#command.eSerial);
        this.#config.eSerial = this.#dataViewString(dv, 1);

        // backgroundColor
        dv = await this.#readData(this.#command.backgroundColor);
        this.#config.backgroundColor = [dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
        this.#svgElement.style.backgroundColor = 'rgb(' + this.#config.backgroundColor.join(',') + ')';

        // penColorAndWidth
        dv = await this.#readData(this.#command.penColorAndWidth);
        this.#config.penColor = [dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
        this.#config.penWidth = dv.getUint8(4);

        // brightness
        dv = await this.#readData(this.#command.brightness);
        this.#config.brightness = dv.getUint8(1);

        // inkMode
        dv = await this.#readData(this.#command.inkMode);
        this.#config.inkMode = dv.getUint8(1) === 1;

        // writingMode
        dv = await this.#readData(this.#command.writingMode);
        this.#config.writingMode = dv.getUint8(1);

        // writingArea
        dv = await this.#readData(this.#command.writingArea);
        this.#config.writingArea = [dv.getUint16(1, true), dv.getUint16(3, true), dv.getUint16(5, true), dv.getUint16(7, true)];

        // set the svg viewbox to width & height
        this.#svgElement.setAttribute('version', '2.0');
        this.#svgElement.setAttribute('viewBox', '0 0 ' + this.#config.width + ' ' + this.#config.height);
        this.#svgElement.setAttribute('width', this.#config.width + 'px');
        this.#svgElement.setAttribute('height', this.#config.height + 'px');

        return true;
    }

    /**
     * Retrives general data from the device
     * @returns {Object} info of the device
     */
    getTabletInfo() {
        // return clone, add time and connection
        return Object.assign({
            connected: this.isConnected(),
            timestamp: Date.now()
        }, this.#config);
    }

    /**
     * returns the svg element to display live signature data on the screen
     * @returns SVGElement
     */
    getSvgElement() {
        return this.#svgElement;
    }

    /**
     * get the svg image of the signature.
     * @param {Boolean} asUrl true to return a string containing an object URL that can be used to reference the contents of the specified source
     * @returns {Blob|String}
     */
    getSvg(asUrl=false) {
        if (asUrl) {
            return URL.createObjectURL(this.#getSvgBlob());
        } else {
            return this.#getSvgBlob();
        }
    }

    /**
     * Creates a signature over the svg and append it in a comment.
     * @param {CryptoKey|null} privateKey private keyfor signing
     * @param {CryptoKey|String|null} publicKey or Certificate to check sign
     * @param {Object|String|null} algorithm (default: ECDSA over P-384 curve)
     * @param {Boolean} asUrl true to return a string containing an object URL that can be used to reference the contents of the specified source
     * @returns {Blob|String}
     */
    async getSvgSigned(privateKey=null, publicKey=null, algorithm=null, asUrl=false) {
        const blob = this.#getSvgBlob(), data = await blob.arrayBuffer();

        if (privateKey !== null && !(privateKey instanceof CryptoKey)) {
            throw new Error('invalid key for signing svg, not CryptoKey');
        }

        if (algorithm === null) {
            algorithm = {
                name: 'ECDSA',
                hash: {name: 'SHA-384'},
                namedCurve: 'P-384'
            };
        }

        // generate a key pair
        if (privateKey === null) {
            const keyPair = await window.crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
            privateKey = keyPair.privateKey;
            publicKey = keyPair.publicKey;
        }

        // create signature
        let sig = await window.crypto.subtle.sign(algorithm, privateKey, data);

        let signatureBlock = '<!-- ' + "\n";

        // append public key
        if (publicKey && publicKey instanceof CryptoKey) {
            signatureBlock += 'public key: ';
            let pk = await window.crypto.subtle.exportKey('spki', publicKey);
            let sigBytes = new Uint8Array(pk);
            for (let i = 0; i < sigBytes.length; i++) {
                signatureBlock += sigBytes[i].toString(16).padStart(2, '0');
            }
            signatureBlock += "\n";

        // or certificate
        } else  if (publicKey && typeof publicKey === 'string') {
            signatureBlock += 'certificate: ' + publicKey + "\n";
        }


        // append signature
        signatureBlock += 'signature: ';
        let sigBytes = new Uint8Array(sig);
        for (let i = 0; i < sigBytes.length; i++) {
            signatureBlock += sigBytes[i].toString(16).padStart(2, '0');
        }
        signatureBlock += "\n-->";

        const b = new Blob([blob, signatureBlock], {type: 'image/svg+xml'});
        if (asUrl) {
            return URL.createObjectURL(b);
        } else {
            return b;
        }
    }

    /**
     * Check if there is a signature stored.
     * @param {Boolean} withTouchingDevice false to not check if the screen was touched
     * @returns {Boolean}
     */
    hasSignatureData(withTouchingDevice=true) {
        if (withTouchingDevice) {
            for (let i = 0; i < this.#signaturePath.length; i++) {
                if (this.#signaturePath[i].sw) {
                    return true;
                }
            }
            return false;
        } else {
            return this.#signaturePath.length > 0;
        }
    }

    /**
     * Set pen color
     * @param {String} color color in '#RRGGBB' format
     * @param {Number} width pen thickness, can be 0-3
     */
    async setPenColorAndWidth(color, width) {
        if (!this.isConnected()) {
            throw new Error('device not connected');
        }
        if ([0,1,2,3].indexOf(width) === -1) {
            throw new Error('invalid value for setPenColorAndWidth width');
        }

        let c = color.replace('#', '').split(/(?<=^(?:.{2})+)(?!$)/).map(e => parseInt("0x" + e, 16)); //Converts "#RRGGBB" to Array(r,g,b)
        c.push(parseInt(width)); // Insert width byte, so array now has 4 elements

        await this.#sendData(this.#command.penColorAndWidth, new Uint8Array(c));

        // save to config
        this.#config.penColor = [c[0], c[1], c[2]];
        this.#config.penWidth = c[3];

    }

    /**
     * Set backlight intensity, can be 0-3.
     * Note: it seems its not good to call this frequently.
     * See: http://developer-docs.wacom.com/faqs/docs/q-stu/stu-sdk-application#how-can-i-switch-the-stu-off-when-not-in-use
     * @param {Number} intensity 0-3
     */
    async setBrightness(intensity) {
        if (!this.isConnected()) {
            throw new Error('device not connected');
        }

        if ([0,1,2,3].indexOf(intensity) === -1) {
            throw new Error('invalid value for setBrightness intensity');
        }

        // Check if device already has this value, to avoid unnecessary writes
        let dv = await this.#readData(this.#command.brightness);
        if (dv.getUint8(1) === intensity) {
            return;
        }
        await this.#sendData(this.#command.brightness, new Uint8Array([intensity, 0]));

        // save to config
        this.#config.brightness = intensity;
    }

    /**
     * Set background color, must clear screen to take effect
     * Note: it seems its not good to call this frequently
     * @param {String} color color in '#RRGGBB' format
     */
    async setBackgroundColor(color) {
        if (!this.isConnected()) {
            throw new Error('device not connected');
        }

        // Converts "#RRGGBB" to Array(r,g,b)
        let c = color.replace('#', '').split(/(?<=^(?:.{2})+)(?!$)/).map(e => parseInt("0x" + e, 16));

        // Check if device already has this value, to avoid unnecessary writes
        let dv = await this.#readData(this.#command.backgroundColor);
        if (dv.getUint8(1) === c[0] && dv.getUint8(2) === c[1] && dv.getUint8(3) === c[2]) {
            return;
        }

        await this.#sendData(this.#command.backgroundColor, new Uint8Array(c));

        // save to config
        this.#config.backgroundColor = [c[0], c[1], c[2]];
    }

    /**
     * Set writing area of the tablet.
     * @param {Object} p format {x1:0,y1:0,x2:800,y2:480} where x1,y1=left top and x2,y2=right bottom
     */
    async setWritingArea(p) {
        if (!this.isConnected()) {
            throw new Error('device not connected');
        }

        let pk = this.#createPacket(8);
        pk.view.setUint16(0, p.x1, true);
        pk.view.setUint16(2, p.y1, true);
        pk.view.setUint16(4, p.x2, true);
        pk.view.setUint16(6, p.y2, true);

        await this.#sendData(this.#command.writingArea, pk.data);

        // save to config
        this.#config.writingArea = [
            p.x1,
            p.y1,
            p.x2,
            p.y2
        ];
    }

    /**
     * Set writing mode
     * @param {Number} mode 0: stroke with width from setting, 1: stroke with width from pressure
     */
    async setWritingMode(mode) {
        if (!this.isConnected()) {
            throw new Error('device not connected');
        }
        if ([0,1].indexOf(mode) === -1) {
            throw new Error('invalid value for setWritingMode');
        }

        await this.#sendData(this.#command.writingMode, new Uint8Array([mode]));

        // save to config
        this.#config.writingMode = mode;
    }

    /**
     * Enable or disable inking the screen. This does not stop events.
     * @param {Boolean} enabled Status of inking
     */
    async setInking(enabled) {
        if (!this.isConnected()) {
            throw new Error('device not connected');
        }

        await this.#sendData(this.#command.inkMode, new Uint8Array([enabled ? 1 : 0]));

        // save to config
        this.#config.inkMode = !!enabled;
    }

    /**
     * Clear screen to background color
     */
    async clearScreen() {
        if (!this.isConnected()) {
            throw new Error('device not connected');
        }
        await this.#sendData(this.#command.clearScreen, new Uint8Array([0]));

        // clear current signature path
        this.#clearSignatureData();

        // set background color
        this.#svgElement.style.backgroundColor = 'rgb(' + this.#config.backgroundColor.join(',') + ')';
    }

    /**
     * send a canvas to the pad. the canvas should have the dimension of the pad.
     * @param {CanvasRenderingContext2D} ctx Canvas 2D
     * @param {Number} offsetX offset to read the image data
     * @param {Number} offsetY offset to read the image data
     * @param {Boolean} drawToSvg draw image do svg
     * @returns {Promise}
     */
    async setCanvas(ctx, offsetX=0, offsetY=0, drawToSvg=true) {

        //Obtain image pixels
        let imageData = ctx.getImageData(offsetX, offsetY, this.#config.width, this.#config.height);

        //Remap pixels to BGR 24bpp
        const rgb24 = new Uint8Array((imageData.data.length / 4) * 3);

        let i = 0, j = 0;
        while (i < imageData.data.length) {
            //Remap pixels, discard alpha
            rgb24[j++] = imageData.data[i + 2];
            rgb24[j++] = imageData.data[i + 1];
            rgb24[j++] = imageData.data[i + 0];
            i += 4;
        }

        // get image as data url to paint after to the canvas
        let dataUrl = drawToSvg ? ctx.canvas.toDataURL() : null;

        await this.setImage(rgb24);

        // draw image to svg
        if (drawToSvg) {
            let svgImage = document.createElementNS("http://www.w3.org/2000/svg", "image");
            svgImage.setAttribute('x', 0);
            svgImage.setAttribute('y', 0);
            svgImage.setAttribute('width', this.#config.width);
            svgImage.setAttribute('height', this.#config.height);
            svgImage.setAttribute('href', dataUrl);
            this.#svgElement.append(svgImage);
        }
    }

    /**
     * Send a raw image to the pad.
     * @param {Array} imageData Image must be BGR 24bpp 800x480.
     */
    async setImage(imageData) {
        if (!this.isConnected()) {
            throw new Error('device not connected');
        }

        if (imageData.length !== (this.#config.width * this.#config.height * 3)) {
            throw new Error('setImage: invalid imageData');
        }

        // check if we are already sending data at this moment
        let tryCnt = 0;
        while (this.#deviceIsSending) {
            if (tryCnt < 20) {
                tryCnt++;
                await this.#wait(500);
            } else {
                throw new Error('cannot setImage: sending blocked for more than 10 seconds by other calls');
            }
        }
        this.#deviceIsSending = true;

        const imageDataBulks = this.#splitToBulks(imageData, this.#config.chunkSize);

        //Only 24BGR is supported now, send start packet, then chunked data packets, then end packet
        await this.#sendData(this.#command.writeImageStart, new Uint8Array([this.#config.imageFormat24BGR]));

        imageDataBulks.forEach(async (e) => {
            await this.#sendData(this.#command.writeImageData, new Uint8Array([e.length, 0].concat(e)));
        });

        await this.#sendData(this.#command.writeImageEnd, new Uint8Array([0]));

        // clear current signature path
        this.#clearSignatureData();

        this.#deviceIsSending = false;
    }

    // -------------------------------------------------
    // private methods
    // -------------------------------------------------

    /**
     * raise a event
     * @param {String} eventName
     * @param {Array} args
     * @returns {undefined}
     */
    #raiseEvent(eventName, args) {
        for (let i = 0; i < this.#events.length; i++) {
            if (this.#events[i].eventName === eventName) {
                this.#events[i].callbackFn.apply(this.#events[i].context || window, args);
            }
        }
    }

    #onHidInputReport(event) {

        // See WacomGSS_ReportHandlerFunctionTable on the SDK. just read onPenData and onPenDataTimeCountSequence, depending
        // of the write mode used (0/1). Start/End capture toggles encryption which im not in the mood of implement, so not using it.
        if (event.reportId === this.#command.penData || event.reportId === this.#command.penDataTiming) {

            let packet = {
                rdy: (event.data.getUint16(0) & 0x8000) !== 0,                              // true if pen is in proximity of the tablet
                sw: (event.data.getUint16(0) & 0x1000) !== 0,                               // true if pen is in contact with tablet
                press: (event.data.getUint16(0) & 0x3FF),                                   // absolute value from device
                cpress: (event.data.getUint16(0) & 0x3FF) / this.#config.tabletMaxPressure, // relative value 0 ... 1
                cx: Math.round(event.data.getUint16(2) / this.#config.scaleFactorX),        // relative to screen pixels
                cy: Math.round(event.data.getUint16(4) / this.#config.scaleFactorY),        // relative to screen pixels
                x: event.data.getUint16(2),                                                 // Tablet units
                y: event.data.getUint16(4),                                                 // Tablet units
                seq: null,
                time: null
            };

            if (event.reportId === this.#command.penDataTiming) {
                packet.time = event.data.getUint16(6); // Extra timing
                packet.seq = event.data.getUint16(8); // Extra incremental number
            }

            // signature stack
            this.#signaturePath.push(packet);

            // draw last added point
            this.#drawSignaturePathToCanvas(this.#signaturePath.length - 1);

            // callback
            this.#raiseEvent('penData', [packet]);
        }
    }

    /**
     * create a blob of the svg
     * @returns {Blob}
     */
    #getSvgBlob() {
        let xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>' + "\n";

        // add raw infos to svg comment
        let rawData = "\n" + '<!-- raw: ' + JSON.stringify({device: this.getTabletInfo(), path: this.#signaturePath}) + "-->\n";

        // create blob
        return new Blob([xmlHead, this.#svgElement.outerHTML, rawData], {type: 'image/svg+xml'});
    }

    /**
     * clear stored signature data
     * @returns {undefined}
     */
    #clearSignatureData() {
        this.#signaturePath = [];
        this.#svgElement.innerHTML = '';
        this.#svgPolyLine = null;
    }

    /**
     * draw all points to the canvas
     * @param {Number} fromOffset
     * @returns {undefined}
     */
    #drawSignaturePathToCanvas(fromOffset=0) {

        for (let i=fromOffset; i < this.#signaturePath.length; i++) {
            let point = this.#signaturePath[i], prevPoint = i > 0 ? this.#signaturePath[i-1] : null;

            if (point.rdy && point.sw && this.#config.inkMode && this.#isInWritingArea(point.cx, point.cy)) {
                if (!this.#svgPolyLine) {
                    this.#startPolyLine();

                // if the pressure difference is high, we start a new polyline with different stroke-width
                } else if (prevPoint && (Math.abs(point.cpress - prevPoint.cpress) > 0.02)) {
                    this.#addPolyPoint(point.cx, point.cy);
                    this.#startPolyLine();
                }

                // add this point
                this.#addPolyPoint(point.cx, point.cy);

            // finish line
            } else if (this.#svgPolyLine) {
                this.#svgPolyLine = null;
            }
        }
    }

    /**
     * check if coordinate is in writing area
     * @param {Number} x
     * @param {Number} y
     * @returns {Boolean}
     */
    #isInWritingArea(x, y) {
        let area = this.#config.writingArea;
        if (!area) {
            return true;
        }

        const x1 = area[0], y1 = area[1], x2 = area[2], y2 = area[3];

        if (x < x1 || x > x2) {
            return false;
        }
        if (y < y1 || y > y2) {
            return false;
        }

        return true;
    }

    /**
     * start a new line
     * @returns {undefined}
     */
    #startPolyLine() {
        let strokeWidth = 1;

        // writing mode 1: stroke width from Pressure
        if (this.#signaturePath.length > 0 && this.#config.writingMode === 1) {
            let lastPressure = this.#signaturePath[this.#signaturePath.length-1].cpress;
            strokeWidth = 1 + (lastPressure * 1.5);

        } else {
            // fixed stroke width
            switch (this.#config.penWidth) {
                case 0: strokeWidth = 0.5; break;
                case 1: strokeWidth = 2; break;
                case 2: strokeWidth = 3; break;
                case 3: strokeWidth = 4.5; break;
            }
        }

        this.#svgPolyLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        this.#svgPolyLine.setAttribute('fill', 'none');
        this.#svgPolyLine.setAttribute('stroke', 'rgb(' + this.#config.penColor.join(',') + ')');
        this.#svgPolyLine.setAttribute('stroke-width', strokeWidth);
        this.#svgPolyLine.setAttribute('stroke-linecap', 'round');
        this.#svgPolyLine.setAttribute('stroke-linejoin', 'round');
        this.#svgElement.append(this.#svgPolyLine);
    }

    /**
     * append a new point to the svg.
     * @param {Number} x
     * @param {Number} y
     * @returns {undefined}
     */
    #addPolyPoint(x, y) {
        let point = this.#svgElement.createSVGPoint();
        point.x = x;
        point.y = y;
        this.#svgPolyLine.points.appendItem(point);
    }

    /**
     * Send direct usb hid feature report (internal usage)
     * @param {Number} reportId ID of the report to read. Use one of this.#command
     * @param {Uint8Array} data Data to send
     */
    async #sendData(reportId, data) {
        if (!this.isConnected()) {
            return;
        }
        await this.#device.sendFeatureReport(reportId, data);
    }

    /**
     * Get a report from the device (internal usage)
     * @param {Number} reportId ID of the report to read. Use one of this.#command
     * @returns {DataView} data returned or null
     */
    async #readData(reportId) {
        if (!this.isConnected()) {
            return;
        }
        return await this.#device.receiveFeatureReport(reportId);
    }

    /**
     * Return an object containing an array of (len) bytes and a DataView for manipulation
     * (internal usage)
     * @param {any} len size in bytes of the packet
     * @return {Object}
     */
    #createPacket(len) {
        let p = new Uint8Array(len);
        let v = new DataView(p.buffer);
        return {data: p, view: v};
    }

    /**
     * Truncates a long array (arr) into smaller arrays of bulkSize
     * (into an array, last item's length could be less than bulkSize)
     * (internal usage)
     * @param {Array} arr Array or derivated type containing full image data
     * @param {Number} bulkSize size of the resulting subarrays
     * @returns {Array} Array of arrays containing data splitted
     */
    #splitToBulks(arr, bulkSize) {
        const bulks = [];
        for (let i = 0; i < Math.ceil(arr.length / bulkSize); i++) {
            let a = Array(bulkSize);
            for (let x = i * bulkSize, z = 0; x < (i + 1) * bulkSize; x++, z++) {
                a[z] = arr[x];
            }
            bulks.push(a);
        }

        return bulks;
    }

    /**
     * Obtains an ASCII string from DataView
     * @param {DataView} dv DataView to read
     * @param {Number} offset Position to start
     * @param {Number} length Optional end of string
     * @returns {String} String result
     */
    #dataViewString(dv, offset, length) {
        let end = typeof length === 'number' ? offset + length : dv.byteLength,
                text = '',
                val = -1;

        while (offset < dv.byteLength && offset < end) {
            val = dv.getUint8(offset++);

            if (val === 0) {
                break;
            }
            text += String.fromCharCode(val);
        }

        return text;
    }

    /**
     * Helper Function to wait
     * @param {Number} ms
     * @returns {Promise}
     */
    #wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
