fn main() {
    // NDK r27 requires explicit ELF LOAD and RELRO alignment for Android's
    // 16 KB page-size support. Limit these flags to the Android shared library.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg-cdylib=-Wl,-z,max-page-size=16384");
        println!("cargo:rustc-link-arg-cdylib=-Wl,-z,common-page-size=16384");
    }
    tauri_build::build()
}
