/* -----------------------------------------------------------------------------------------------
 * Invitation Model
 * ----------------------------------------------------------------------------------------------*/

// Declare dependencies and prevent leaking into global scope
(function(
           exports,                 // Environment
           $, Backbone, _, log,     // External libraries
                                    // Application modules
           undefined
         ) {

  exports.Invitation = Backbone.Model.extend({

    defaults: {
      incoming: false,
      remoteUser: null,
      sessionId: null,
      token: null,
      apiKey: null
    },

    urlRoot: '/chats',

    parse: function(response, options) {
      var copy = _.clone(this.attributes);
      return _.extend(copy, response);
    },

    isReadyForChat: function() {
      return (this.get('token') && this.get('sessionId') && this.get('apiKey'));
    },

    getChatInfo: function(success, fail) {
      var self = this;
      $.get('/chats', { sessionId: this.get('sessionId') })
        .done(function(data) {
          log.info('Invitation: getChatInfo');
          self.set(data);
          success();
        })
        .fail(function(jqXHR, textStatus, errorThrown) {
          log.error('Invitation: getChatInfo failed', errorThrown);
          fail(errorThrown);
        });
    },

    toSignal: function() {
      return JSON.stringify({
        sessionId: this.get('sessionId'),
        apiKey: this.get('apiKey')
      });
    },

    fromSignal: function(signalData) {
      this.set(JSON.parse(signalData));
    }

  });

}(window, jQuery, Backbone, _, log));
