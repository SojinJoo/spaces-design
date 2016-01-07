/*
 * Copyright (c) 2015 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

define(function (require, exports) {
    "use strict";

    var Promise = require("bluebird");

    var PS = require("adapter").ps,
        OS = require("adapter").os,
        UI = require("adapter").ps.ui,
        descriptor = require("adapter").ps.descriptor,
        toolLib = require("adapter").lib.tool,
        vectorMaskLib = require("adapter").lib.vectorMask;
        
    var shortcuts = require("js/actions/shortcuts"),
        locks = require("js/locks"),
        events = require("js/events");

    var _TOGGLE_TARGET_PATH = 3502,
        _CLEAR_PATH = 106;

    /**
     * Handler for pathComponentSelectionChanged and mouseDown events
     */
    var _pathSelectionhandler,
        _mouseDownHandler;

    /**
     * Sets the selection mode to only active layers for direct select tool
     * @private
     */
    var select = function () {
        var deleteFn = function (event) {
            event.stopPropagation();
            
            var flux = this.flux,
                toolStore = flux.store("tool");

            if (toolStore.getVectorMode()) {
                flux.actions.mask.handleDeleteVectorMask();
            } else {
                return PS.performMenuCommand(_CLEAR_PATH)
                    .catch(function () {
                        // Silence the errors here
                    });
            }
        }.bind(this);

        _pathSelectionhandler = function (event) {
            if (event.pathID && event.pathID.length === 0) {
                var toolStore = this.flux.store("tool");

                this.flux.actions.tools.select(toolStore.getToolByID("newSelect"));
            }
        }.bind(this);
        descriptor.addListener("pathComponentSelectionChanged", _pathSelectionhandler);

        _mouseDownHandler = function (event) {
            if (event.clickCount === 2) {
                this.flux.actions.tool.superselect.vector.doubleclick();
            }
        }.bind(this);
        OS.addListener("externalMouseDown", _mouseDownHandler);
        
        var optionsPromise = descriptor.playObject(toolLib.setDirectSelectOptionForAllLayers(false)),
            suppressionPromise = UI.setSuppressTargetPaths(false),
            backspacePromise = this.transfer(shortcuts.addShortcut,
                OS.eventKeyCode.BACKSPACE, {}, deleteFn, "vectorBackspace", true),
            deletePromise = this.transfer(shortcuts.addShortcut,
                OS.eventKeyCode.DELETE, {}, deleteFn, "vectorDelete", true),
            getPathVisiblePromise = descriptor.getProperty("document", "targetPathVisibility");

        return Promise.join(getPathVisiblePromise,
            optionsPromise,
            suppressionPromise,
            backspacePromise,
            deletePromise,
            function (visible) {
                if (!visible) {
                    return PS.performMenuCommand(_TOGGLE_TARGET_PATH);
                }
            });
    };
    select.action = {
        reads: [],
        writes: [locks.PS_APP, locks.PS_TOOL],
        transfers: ["shortcuts.addShortcut"],
        modal: true
    };

    /**
     * Updates current document because we may have changed bounds in Photoshop
     *
     * @return {Promise}
     */
    var deselect = function () {
        var currentDocument = this.flux.store("application").getCurrentDocument();

        var backspacePromise = this.transfer(shortcuts.removeShortcut, "vectorBackspace"),
            deletePromise = this.transfer(shortcuts.removeShortcut, "vectorDelete");

        descriptor.removeListener("pathComponentSelectionChanged", _pathSelectionhandler);
        OS.removeListener("externalMouseDown", _mouseDownHandler);
        
        _pathSelectionhandler = null;
        _mouseDownHandler = null;

        return Promise.join(backspacePromise, deletePromise)
            .bind(this)
            .then(function () {
                if (currentDocument) {
                    this.flux.actions.layers.resetLayers(currentDocument, currentDocument.layers.selected);
                }
            });
    };
    deselect.action = {
        reads: [locks.JS_APP],
        writes: [],
        transfers: ["shortcuts.removeShortcut"],
        modal: true
    };

    /**
    * switch to superselect tool, while unlinking the vector mask from the layer.  
    *
    * @return {Promise}
    */
    var doubleclick = function () {
        var flux = this.flux,
            toolStore = flux.store("tool"),
            vectorMaskMode = toolStore.getVectorMode(),
            appStore = flux.store("application"),
            currentDocument = appStore.getCurrentDocument();

        if (!currentDocument) {
            return Promise.resolve();
        }

        var currentLayers = currentDocument.layers.selected,
            currentLayer = currentLayers.first();

        // vector mask mode requires an active layer
        if (!currentLayer || !vectorMaskMode) {
            return Promise.resolve();
        } else {
             return PS.endModalToolState(true) 
                .bind(this)
                .then(function () {
                    return descriptor.playObject(vectorMaskLib.setVectorMaskLinked(false));
                })
                .then(function () {
                    return this.dispatchAsync(events.tool.VECTOR_MASK_UNLINK_CHANGE, true);
                })
                .then(function () {
                    return descriptor.playObject(vectorMaskLib.dropPathSelection());
                })
                .then(function () {
                    return this.transfer("tools.select", toolStore.getToolByID("newSelect"));
                });
        }
    };
    doubleclick.action = {
        reads: [locks.JS_APP],
        writes: [locks.PS_APP],
        transfers: ["tools.select"]
    };

    exports.doubleclick = doubleclick;
    exports.select = select;
    exports.deselect = deselect;
});
