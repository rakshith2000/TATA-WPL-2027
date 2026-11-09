from flask import Blueprint, render_template, url_for, request, redirect, flash, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import login_user, logout_user, login_required, current_user
from .models import User
from . import db
from datetime import datetime
import os, base64
from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response
)

auth = Blueprint('auth', __name__)

RP_ID = "tata-wpl-2027.onrender.com"
ORIGIN = "https://tata-wpl-2027.onrender.com"

def b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')

@auth.route('/login')
def login():
    users = User.query.all()
    return render_template('login.html', users=users)

@auth.route('/login', methods=['POST'])
def login_post():
    email = request.form.get('email')
    password = request.form.get('password')
    remember = True if request.form.get('remember') else False
    user = User.query.filter_by(email=email).first()
    print(user)
    if not user or not check_password_hash(user.password, password):
        flash('Invalid username or password', category='error')
        return redirect(url_for('auth.login'))

    login_user(user, remember=remember)
    return redirect(url_for('main.update'))

@auth.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('main.index'))

# --------------------------------------------------
# WEB AUTHN – REGISTER
# --------------------------------------------------
@auth.route("/webauthn/register/options")
@login_required
def webauthn_register_options():
    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name="Flask Hybrid Auth",
        user_id=current_user.id.bytes,
        user_name=current_user.email,
    )
    print(options)
    session["webauthn_reg_challenge"] = options.challenge
    response = {
        "challenge": b64encode(options.challenge),
        "rp": {
            "name": options.rp.name,
            "id": options.rp.id,
        },
        "user": {
            "id": b64encode(options.user.id),
            "name": options.user.name,
            "displayName": options.user.display_name,
        },
        "pubKeyCredParams": [
            {
                "type": p.type,
                "alg": p.alg
            } for p in options.pub_key_cred_params
        ],
        "timeout": options.timeout,
        "attestation": options.attestation,
    }
    print(jsonify(response))
    return jsonify(response)

@auth.route("/webauthn/register/verify", methods=["POST"])
@login_required
def webauthn_register_verify():
    credential = verify_registration_response(
        credential=request.json,
        expected_challenge=session.get("webauthn_reg_challenge"),
        expected_origin=ORIGIN,
        expected_rp_id=RP_ID,
    )

    current_user.webauthn_credential_id = credential.credential_id
    current_user.webauthn_public_key = credential.credential_public_key
    current_user.webauthn_sign_count = credential.sign_count

    db.session.commit()
    return {"status": "biometric_registered"}

# --------------------------------------------------
# WEB AUTHN – LOGIN
# --------------------------------------------------

@auth.route("/webauthn/login/options", methods=["POST"])
def webauthn_login_options():
    username = request.json.get("username")
    user = User.query.filter_by(email=username).first()

    if not user or not user.webauthn_credential_id:
        return jsonify({"error": "Biometric not registered"}), 400

    options = generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=[{
            "id": user.webauthn_credential_id,
            "type": "public-key"
        }]
    )

    session["webauthn_auth_challenge"] = options.challenge
    session["webauthn_auth_user"] = str(user.id)

    response = {
        "challenge": b64encode(options.challenge),
        "timeout": options.timeout,
        "rpId": options.rp_id,
        "allowCredentials": [
            {
                "id": b64encode(cred['id']),
                "type": cred['type']
            } for cred in options.allow_credentials
        ],
        "userVerification": "preferred"
        }

    return jsonify(response)

@auth.route("/webauthn/login/verify", methods=["POST"])
def webauthn_login_verify():
    user = User.query.get(session.get("webauthn_auth_user"))

    verification = verify_authentication_response(
        credential=request.json,
        expected_challenge=session.get("webauthn_auth_challenge"),
        expected_origin=ORIGIN,
        expected_rp_id=RP_ID,
        credential_public_key=user.webauthn_public_key,
        credential_current_sign_count=user.webauthn_sign_count,
    )

    user.webauthn_sign_count = verification.new_sign_count
    db.session.commit()

    login_user(user)
    return {"status": "logged_in"}