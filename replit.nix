{ pkgs }: {
  deps = [
    pkgs.jdk21
    pkgs.maven
    pkgs.nodejs_22
    pkgs.postgresql_16
    pkgs.git
    pkgs.curl
    pkgs.jq
  ];
}
