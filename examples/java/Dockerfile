# syntax=docker/dockerfile:1
# Build: docker build --secret id=maven-settings,src=$HOME/.m2/settings.xml -t notes .   (Maven reads GitHub Packages with the token in it)
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY .mvn .mvn
COPY mvnw pom.xml ./
COPY src src
RUN --mount=type=secret,id=maven-settings,target=/root/.m2/settings.xml ./mvnw -B -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/notes-0.0.1-SNAPSHOT.jar app.jar
# The signing keys live here: mount one volume shared by every instance, and start one instance first.
VOLUME /app/keys
ENV EGRADX_KEYSTORE_PATH=/app/keys
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
