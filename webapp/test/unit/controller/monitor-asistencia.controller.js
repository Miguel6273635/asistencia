/*global QUnit*/

sap.ui.define([
	"com/mitsu/monitorasistencia/monitorasistencia/controller/monitor-asistencia.controller"
], function (Controller) {
	"use strict";

	QUnit.module("monitor-asistencia Controller");

	QUnit.test("I should test the monitor-asistencia controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
