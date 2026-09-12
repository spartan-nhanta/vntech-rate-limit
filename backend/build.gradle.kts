plugins {
    id("org.jetbrains.kotlin.jvm") version "1.9.23"
    id("org.jetbrains.kotlin.kapt") version "1.9.23"
    id("org.jetbrains.kotlin.plugin.allopen") version "1.9.23"
    id("io.micronaut.application") version "4.4.0"
}

version = "1.0"
group = "com.rldemo"

repositories {
    mavenCentral()
}

dependencies {
    // Micronaut annotation processor (kapt) — validates @Controller, @QueryValue...
    kapt("io.micronaut:micronaut-http-validation")

    // Micronaut core
    implementation("io.micronaut.kotlin:micronaut-kotlin-runtime")
    implementation("io.micronaut:micronaut-http-server-netty")

    // JSON — dùng jackson-databind cũ (không cần @Serdeable trên data class)
    implementation("io.micronaut:micronaut-jackson-databind")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")

    // Reactor — cho Flux<Event<String>> trả về SSE stream
    implementation("io.micronaut.reactor:micronaut-reactor")

    // Redis Lettuce — client Redis chính thức cho Micronaut
    implementation("io.micronaut.redis:micronaut-redis-lettuce")

    // Kotlin coroutines
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-reactor")

    runtimeOnly("ch.qos.logback:logback-classic")
    runtimeOnly("org.yaml:snakeyaml")
}

application {
    mainClass.set("com.rldemo.ApplicationKt")
}

java {
    sourceCompatibility = JavaVersion.toVersion("17")
}

kotlin {
    jvmToolchain(17)
}

micronaut {
    version("4.6.3")
    runtime("netty")
    testRuntime("junit5")
    processing {
        incremental(true)
        annotations("com.rldemo.*")
    }
}
