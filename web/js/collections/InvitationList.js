/* -----------------------------------------------------------------------------------------------
 * Invitation List Collection
 * ----------------------------------------------------------------------------------------------*/

// Declare dependencies and prevent leaking into global scope
(function(
           exports,                 // Environment
           Backbone, _, log,        // External libraries
           Invitation,              // Application modules
           undefined
         ) {

  exports.InvitationList = Backbone.Collection.extend({

    model: Invitation,

    initialize: function(models, options) {
      if (!options.dispatcher) {
        log.error('InvitationList: initialize() cannot be called without a dispatcher');
        return;
      }
      this.dispatcher = options.dispatcher;
      this.dispatcher.once('presenceSessionReady', this.presenceSessionReady, this);
      this.dispatcher.on('inviteRemoteUser', this.inviteRemoteUser, this);
    },

    // Creates an Invitation that can be sent to the RemoteUser
    inviteRemoteUser: function(remoteUser) {
      var self = this;
      log.info('InvitationList: inviteRemoteUser');
      var outgoingInvitation = new Invitation({
        incoming: false,
        invitee: remoteUser
      });
      // Once the invitation is saved, it acquires a sessionId from the server
      outgoingInvitation.save({}, {
        success: function() {
          // Now the invitation is ready to be sent to the remote user via OpenTok signalling
          self.sendInvitation(outgoingInvitation);
        },
        error: function() {
          // TODO: error handling
          log.error('InvitationList: inviteRemoteUser failed to save outgoing invitation');
        }
      });
    },

    // Sents an Invitation using OpenTok signalling
    sendInvitation: function(invitation) {
      var self = this;
      // Construct a signal that can be sent via OpenTok
      var signal = {
        type: 'invitation',
        to: invitation.get('invitee').connection,
        data: invitation.toSignal()
      };
      this.presenceSession.signal(signal, function(err) {
        if (err) {
          // TODO: error handling
          log.error('InvitationList: sendInvitation failed', err);
          return;
        }
        log.info('InvitationList: invitation sent');
        self.add(invitation);
        // Notify other objects that an invitation has been sent (LocalUser will need to change
        // status)
        self.dispatcher.trigger('invitationSent', invitation);
      });
    },

    // Receives an Invitation via OpenTok signalling, and adds it to this collection
    receiveInvitation: function(event) {
      var self = this;
      log.info('InvitationList: invitation received');

      // Handling of the invitation depends on the local user's availability
      this.dispatcher.once('userAvailability', function(available) {
        log.info('InvitationList: user availability', available);
        if (available) {
          // When the local user is available, constructing the Invitation also requires a reference
          // to the correct RemoteUser object
          self.dispatcher.once('remoteUser~'+event.from.connectionId, function(remoteUser) {
            log.info('InvitationList: remote user', remoteUser);
            var incomingInvitation = new Invitation({
              incoming: true,
              inviter: remoteUser
            });
            // Deserialize any data in the signal into the new Invitation object
            incomingInvitation.fromSignal(event.data);
            // Now that the Invitation object has been constructed, it can be added to this
            // collection
            self.add(incomingInvitation);
          });
          // Request a RemoteUser object that corresponds to the connection (the response is handled
          // by the RemoteUser itself or the BuddyList object)
          self.dispatcher.trigger('getRemoteUser', event.from);
        } else {
          // When the local user is not available, this invitation is declined right away
          self.declineInvitation(event.from);
        }
      });
      // Request the user availability (the response is handled by the LocalUser object)
      this.dispatcher.trigger('getUserAvailability');
    },

    // Cancels an outgoing invitation that the local user has already sent via OpenTok signalling
    cancelInvitation: function(index) {
      var self = this;
      var invitation = this.at(index);
      // NOTE: is there ever a situation where the invitation wouldn't be found?
      // Construct a signal that can be sent via OpenTok
      var signal = {
        type: 'cancelInvitation',
        to: invitation.get('invitee').connection,
        data: invitation.toSignal()
      };
      this.presenceSession.signal(signal, function(err) {
        if (err) {
          // TODO: error handling
          log.error('InvitationList: cancelInvitation failed', err);
          return;
        }
        // Once the signal has been sent the invitation can be removed from this collection
        self.remove(invitation);
        // Notify other objects that an invitation has been cancelled (LocalUser will need to change
        // status)
        self.dispatcher.trigger('invitationCancelled', invitation);
      });
    },

    // Receives a cancellation of an incoming invitation via OpenTok signalling, removes it from
    // this collection
    receiveCancellation: function(event) {
      // Find the corresponding Invitation object
      var invitation = this.find(function(invitation) {
        return invitation.get('incoming')  &&
               invitation.get('inviter').connection.connectionId === event.from.connectionId &&
               event.data === invitation.toSignal();
      });
      // If the invitation wasn't found (e.g. there was a race where the local user declined it
      // before the cancellation signal arrived) there's no action necessary, just log it.
      if (!invitation) {
        log.warn('InvitationList: receiveCancellation could not find an invitation to cancel');
        return;
      }
      // Remove the invitation from this collection
      this.remove(invitation);
    },

    // Accepts an incoming invitation via OpenTok signalling
    acceptInvitation: function(index) {
      var self = this;
      var invitation = this.at(index);
      // NOTE: is there ever a situation where the invitation wouldn't be found?
      // Construct a signal that can be sent via OpenTok
      var signal = {
        type: 'acceptInvitation',
        to: invitation.get('inviter').connection,
        data: invitation.toSignal()
      };
      this.presenceSession.signal(signal, function(err) {
        if (err) {
          // TODO: error handling
          log.error('InvitationList: acceptInvitation failed', err);
          return;
        }
        // Now that the Invitation has been accepted, it can be removed from the list
        self.remove(invitation);
        // All other invitations should be declined
        self.each(function(otherInvitation, index) {
          // NOTE: assert that any otherInvitation must be incoming?
          self.declineInvitation(index);
        });
        // Notify other objects that an invitation has been accepted (LocalUser will need to change
        // status, ChatView will need to create a new Chat)
        self.dispatcher.trigger('invitationAccepted', invitation);
      });
    },

    // Recieves acceptance of an outgoing invitation via OpenTok signalling
    receiveAcceptance: function(event) {
      // Find the corresponding Invitation object
      var invitation = this.find(function(invitation) {
        return !invitation.get('incoming')  &&
               invitation.get('invitee').connection.connectionId === event.from.connectionId &&
               event.data === invitation.toSignal();
      });
      // If the invitation wasn't found (e.g. there was a race where the local user cancelled it
      // before the acceptance signal arrived) there's no action necessary, just log it.
      if (!invitation) {
        log.warn('InvitationList: receiveAcceptance could not find an invitation to accept');
        return;
      }
      this.remove(invitation);
      // Notify other objects that an invitation has been accepted (LocalUser will need to change
      // status, ChatView will need to create a new Chat)
      this.dispatcher.trigger('invitationAccepted', invitation);
    },

    // Declines an incoming invitaiton via OpenTok signalling, this could be based on an index in
    // the collection or based on an OpenTok connection
    declineInvitation: function(/* index | connection */) {
      var self = this;
      var invitation;
      // Parse the arguments to decide to do a lookup for the Invitation by index or by connection
      if (typeof arguments[0] === 'number') {
        // Lookup the invitation by index
        invitation = this.at(arguments[0]);
      } else if (arguments[0] instanceof OT.Connection) {
        // Lookup the invitation by connection
        invitation = this.find(function(i) { return i.get('inviter').connection === arguments[0]; });
      }
      // If the invitation wasn't found (e.g. there was a race where the remote user cancelled it
      // before this method was called) there's no action necessary, just log it.
      if (!invitation) {
        log.warn('InvitationList: declineInvitation could not find an invitation to decline');
        return;
      }
      // Construct a signal that can be sent via OpenTok
      var signal = {
        type: 'declineInvitation',
        to: invitation.get('inviter').connection,
        data: invitation.toSignal()
      };
      this.presenceSession.signal(signal, function(err) {
        if (err) {
          // TODO: error handling
          log.error('InvitationList: declineInvitation failed', err);
          return;
        }
        // Once the signal is sent its removed from this collection
        self.remove(invitation);
      });
    },

    // Recieves declination of an outgoing invitation via OpenTok signalling
    receiveDeclination: function(event) {
      // Find the corresponding Invitation object
      var invitation = this.find(function(invitation) {
        return !invitation.get('incoming')  &&
               invitation.get('invitee').connection.connectionId === event.from.connectionId &&
               event.data === invitation.toSignal();
      });
      // If the invitation wasn't found (e.g. there was a race where the local user cancelled it
      // before the declination signal arrived) there's no action necessary, just log it.
      if (!invitation) {
        log.warn('InvitationList: receiveDeclination could not find an invitation to decline');
        return;
      }
      // Remove the invitation from this collection
      this.remove(invitation);
      // NOTE: assert that the collection is empty?
      // Notify other objects that an invitation has been declined (LocalUser will need to change
      // status)
      this.dispatcher.trigger('invitationDeclined', invitation);
    },

    presenceSessionReady: function(presenceSession) {
      this.presenceSession = presenceSession;

      // Receive notifications of all OpenTok signals of interest
      this.presenceSession.on('signal:invitation', this.receiveInvitation, this);
      this.presenceSession.on('signal:cancelInvitation', this.receiveCancellation, this);
      this.presenceSession.on('signal:acceptInvitation', this.receiveAcceptance, this);
      this.presenceSession.on('signal:declineInvitation', this.receiveDeclination, this);
    }

  });

}(window, Backbone, _, log, Invitation));
