#!/usr/bin/env bash
# Exit 1 while a box whose negative spread empties its outset shadow shape paints a bar below it on the attached Android
# device, 0 once none does, 2 when another step fails.
# Needs adb with one Android 9+ device attached (ANDROID_SERIAL picks one of several), node, yarn and a JDK.
set -u

package=com.reproducerapp
empty_label="view whose spread empties its shadow shape"
rounded_empty_label="rounded view whose spread empties its shadow shape"
control_label="view whose spread leaves a shadow shape"

fail_step() {
    echo "step failed: $1"
    exit 2
}

# The path as the platform's own programs take it: Git Bash's /c/... becomes C:/... for node on Windows.
native_path() {
    if command -v cygpath > /dev/null; then
        cygpath -m "$1"
    else
        printf '%s\n' "$1"
    fi
}

# Sets the named variable to a device property, without the carriage return adb's shell ends it with.
read_device_property() {
    local value
    value="$(adb shell getprop "$2")" || fail_step "adb shell getprop $2: ${value}"
    printf -v "$1" '%s' "${value//$'\r'/}"
}

dump_window() {
    adb shell uiautomator dump /sdcard/shadow-reproducer.xml > /dev/null 2>&1
    adb exec-out cat /sdcard/shadow-reproducer.xml > "$1" 2> /dev/null
    adb shell rm -f /sdcard/shadow-reproducer.xml
}

wait_for_label() {
    local hierarchy=$1 label=$2 attempt
    for ((attempt = 1; attempt <= 30; attempt += 1)); do
        dump_window "${hierarchy}"
        if grep -qF "content-desc=\"${label}\"" "${hierarchy}"; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# Prints "left top right bottom" of the node whose content-desc is the label, from a `uiautomator dump`.
bounds_of() {
    local hierarchy=$1 label=$2 bounds
    bounds="$(sed -nE "s/.*content-desc=\"${label}\"[^>]*bounds=\"\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]\".*/\1 \2 \3 \4/p" \
        "${hierarchy}")"
    [[ -n "${bounds}" ]] || return 1
    echo "${bounds}"
}

main() {
    local here app shots
    here="$(cd "$(dirname "$0")" && pwd)"
    app="${here}/ReproducerApp"
    shots="${here}/screenshots"
    work="$(mktemp -d)"
    trap 'rm -rf "${work}"' EXIT
    mkdir -p "${shots}"

    local system node_version java_version
    system="$(uname -sm)"
    node_version="$(node --version 2>&1)" || fail_step "node --version: ${node_version}"
    java_version="$(java -version 2>&1)" || fail_step "java -version: ${java_version}"
    echo "${system}, node ${node_version}, ${java_version%%$'\n'*}"

    local device_state
    device_state="$(adb get-state 2>&1)"
    [[ "${device_state}" == "device" ]] || fail_step "adb get-state: ${device_state}"
    local model release sdk abi sizes densities screen density
    read_device_property model ro.product.model
    read_device_property release ro.build.version.release
    read_device_property sdk ro.build.version.sdk
    read_device_property abi ro.product.cpu.abi
    sizes="$(adb shell wm size)" || fail_step "adb shell wm size: ${sizes}"
    sizes="${sizes//$'\r'/}"
    screen="$(sed -nE 's/^Override size: ([0-9]+x[0-9]+)$/\1/p' <<< "${sizes}")"
    [[ -n "${screen}" ]] || screen="$(sed -nE 's/^Physical size: ([0-9]+x[0-9]+)$/\1/p' <<< "${sizes}")"
    densities="$(adb shell wm density)" || fail_step "adb shell wm density: ${densities}"
    densities="${densities//$'\r'/}"
    density="$(sed -nE 's/^Override density: ([0-9]+)$/\1/p' <<< "${densities}")"
    [[ -n "${density}" ]] || density="$(sed -nE 's/^Physical density: ([0-9]+)$/\1/p' <<< "${densities}")"
    [[ -n "${screen}" && -n "${density}" ]] || fail_step "wm size and wm density: ${sizes} ${densities}"
    echo "device: ${model}, Android ${release} (API ${sdk}), ${abi}, ${screen} at ${density} dpi"
    [[ "${sdk}" -ge 28 ]] || fail_step "React Native draws an outset boxShadow from Android 9 (API 28); this device runs API ${sdk}"

    local install_output react_native_version
    install_output="$(cd "${app}" && yarn install --frozen-lockfile --non-interactive 2>&1)" ||
        { printf '%s\n' "${install_output}" | tail -n 20; fail_step "yarn install"; }
    react_native_version="$(cd "${app}" && node -p 'require("react-native/package.json").version' 2>&1)" ||
        fail_step "reading react-native's version: ${react_native_version}"
    echo "react-native ${react_native_version}"

    echo "== ./gradlew :app:assembleRelease -PreactNativeArchitectures=${abi}"
    local build_output
    build_output="$(cd "${app}/android" && ./gradlew --no-daemon --console=plain :app:assembleRelease \
        "-PreactNativeArchitectures=${abi}" 2>&1)" ||
        { printf '%s\n' "${build_output}" | tail -n 40; fail_step "the release build"; }

    local apk install_result
    apk="$(native_path "${app}/android/app/build/outputs/apk/release/app-release.apk")"
    install_result="$(adb install -r "${apk}" 2>&1)" || fail_step "adb install: ${install_result}"
    adb shell am force-stop "${package}"
    adb shell am start -W -n "${package}/.MainActivity" > /dev/null || fail_step "starting ${package}"

    local hierarchy="${work}/hierarchy.xml" empty_box rounded_empty_box control_box
    wait_for_label "${hierarchy}" "${control_label}" || fail_step "the app showed no \"${control_label}\""
    empty_box="$(bounds_of "${hierarchy}" "${empty_label}")" || fail_step "no bounds for \"${empty_label}\""
    rounded_empty_box="$(bounds_of "${hierarchy}" "${rounded_empty_label}")" ||
        fail_step "no bounds for \"${rounded_empty_label}\""
    control_box="$(bounds_of "${hierarchy}" "${control_label}")" || fail_step "no bounds for \"${control_label}\""
    sleep 2

    local shot="${shots}/boxes.png"
    adb exec-out screencap -p > "${shot}" 2> /dev/null && [[ -s "${shot}" ]] || fail_step "adb exec-out screencap -p"
    echo "screenshot: screenshots/${shot##*/}"

    local compare_script shot_file
    compare_script="$(native_path "${here}/compare-shadow-bars.mjs")"
    shot_file="$(native_path "${shot}")"
    node "${compare_script}" "${shot_file}" "${screen}" "${density}" \
        "empty:${empty_label}=${empty_box// /,}" "empty:${rounded_empty_label}=${rounded_empty_box// /,}" \
        "control:${control_label}=${control_box// /,}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
