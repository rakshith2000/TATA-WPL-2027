function bufferDecode(value) {
    // Convert from URL-safe base64 to standard base64
    value = value.replace(/-/g, '+').replace(/_/g, '/');
    // Pad with '=' to make length a multiple of 4
    while (value.length % 4) {
        value += '=';
    }
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

function bufferEncode(value) {
    return btoa(String.fromCharCode(...new Uint8Array(value)));
}

// ---------------- BIOMETRIC REGISTER ----------------

async function registerBiometric() {
    let options = await fetch("/webauthn/register/options").then(r => r.json());
    options.challenge = bufferDecode(options.challenge);
    options.user.id = bufferDecode(options.user.id);

    const cred = await navigator.credentials.create({ publicKey: options });

    const data = {
        id: cred.id,
        rawId: bufferEncode(cred.rawId),
        response: {
            attestationObject: bufferEncode(cred.response.attestationObject),
            clientDataJSON: bufferEncode(cred.response.clientDataJSON)
        },
        type: cred.type
    };

    await fetch("/webauthn/register/verify", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data)
    });

    alert("Biometric registered");
}

// ---------------- BIOMETRIC LOGIN ----------------

async function biometricLogin() {
    const username = document.getElementById("email").value;

    let options = await fetch("/webauthn/login/options", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username})
    }).then(r => r.json());

    options.challenge = bufferDecode(options.challenge);
    options.allowCredentials[0].id =
        bufferDecode(options.allowCredentials[0].id);

    const assertion = await navigator.credentials.get({ publicKey: options });

    const data = {
        id: assertion.id,
        rawId: bufferEncode(assertion.rawId),
        response: {
            authenticatorData: bufferEncode(assertion.response.authenticatorData),
            clientDataJSON: bufferEncode(assertion.response.clientDataJSON),
            signature: bufferEncode(assertion.response.signature)
        },
        type: assertion.type
    };

    await fetch("/webauthn/login/verify", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data)
    });

    window.location.href = "/update";
}