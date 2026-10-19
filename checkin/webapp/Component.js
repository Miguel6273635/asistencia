sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("com.mitsu.checkin.Component", {
    metadata: { manifest: "json" },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel({ busy: false }), "app");
    }
  });
});
