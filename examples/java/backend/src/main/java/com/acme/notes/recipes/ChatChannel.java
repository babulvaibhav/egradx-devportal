package com.acme.notes.recipes;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

import com.egradx.notification.EgradxChannel;
import com.egradx.notification.EgradxMessageContent;
import com.egradx.notification.spi.EgradxDeliveryRequest;
import com.egradx.notification.spi.EgradxDeliveryResult;
import com.egradx.notification.spi.EgradxNotificationChannel;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

// docs:region custom-channel
/**
 * A channel of your own: messages posted to a chat service's incoming webhook. Declare it as a bean (@Component or a
 * @Bean method) and EgradxChannel.of("chat") can be sent on like any other; the dispatcher calls send() for each
 * address, after the commit, with retries.
 */
public class ChatChannel implements EgradxNotificationChannel {

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ObjectMapper json = new ObjectMapper();

    @Override
    public EgradxChannel channel() {
        return EgradxChannel.of("chat");
    }

    /** Checked when a message is sent, before anything is queued. */
    @Override
    public void validateAddress(String address) {
        if (!address.startsWith("https://")) {
            throw new IllegalArgumentException("A chat address is the https URL of an incoming webhook");
        }
    }

    @Override
    public EgradxDeliveryResult send(EgradxDeliveryRequest request) {
        EgradxMessageContent content = request.content();
        String text = content.subject() == null ? content.body() : content.subject() + "\n" + content.body();
        try {
            HttpRequest post = HttpRequest.newBuilder(URI.create(request.address()))
                .timeout(Duration.ofSeconds(15))                                  // bound every call
                .header("Content-Type", "application/json")
                .header("Idempotency-Key", request.deliveryId().toString())     // delivery is at least once
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("text", text))))
                .build();
            int status = http.send(post, HttpResponse.BodyHandlers.discarding()).statusCode();
            if (status / 100 == 2) {
                return EgradxDeliveryResult.sent(null);
            }
            return status == 429 || status >= 500
                ? EgradxDeliveryResult.retryable("The chat service answered " + status)     // tried again later
                : EgradxDeliveryResult.permanent("The chat service refused it: " + status); // dead at once
        } catch (JsonProcessingException e) {
            return EgradxDeliveryResult.permanent("The message could not be written: " + e.getMessage());
        } catch (IOException e) {
            return EgradxDeliveryResult.retryable("The chat service could not be reached: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return EgradxDeliveryResult.retryable("Interrupted");
        }
    }
}
// docs:end
